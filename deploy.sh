#!/bin/sh
# ============================================================
# 工作流程跟踪工作台 —— NAS 一键部署脚本
#
# 用法（在 NAS 的项目目录下执行）：
#   ./deploy.sh          首次部署：生成 .env、构建、启动
#   ./deploy.sh update   拉取更新并重建
#   ./deploy.sh backup   备份数据库
#   ./deploy.sh logs     查看日志
#   ./deploy.sh stop     停止
#   ./deploy.sh reset-pwd <用户名> <新密码>   直接重置密码（忘记密码时用）
# ============================================================
set -e

APP_NAME="workflow-tracker"

# ---------- 检查 Docker ----------
check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "错误：未检测到 docker 命令，请先在 NAS 上安装 Docker。"
    exit 1
  fi
  if docker compose version >/dev/null 2>&1; then
    DC="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    DC="docker-compose"
  else
    echo "错误：未检测到 docker compose，请安装 Docker Compose 插件。"
    exit 1
  fi
}

# ---------- 生成 .env ----------
ensure_env() {
  if [ -f .env ]; then
    echo "==> 已存在 .env，沿用现有配置"
    return
  fi

  echo "==> 首次部署，生成 .env"
  cp .env.example .env

  # 生成随机管理员密码
  RAND_PWD=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 14)
  # 数据目录用脚本所在位置的绝对路径
  ABS_DATA="$(pwd)/data"

  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${RAND_PWD}|" .env
  sed -i "s|^DATA_PATH=.*|DATA_PATH=${ABS_DATA}|" .env

  echo ""
  echo "=================================================="
  echo " 已生成配置文件 .env"
  echo " 管理员账号：admin"
  echo " 初始密码：  ${RAND_PWD}"
  echo " 请立即保存，首次登录后建议在界面中修改"
  echo "=================================================="
  echo ""
}

case "${1:-up}" in
  up)
    check_docker
    ensure_env
    . ./.env 2>/dev/null || true

    mkdir -p "${DATA_PATH:-./data}"
    # 容器内以 node(1000) 运行，确保数据目录可写
    if [ "$(id -u)" = "0" ]; then
      chown -R 1000:1000 "${DATA_PATH:-./data}" 2>/dev/null || true
    fi
    # 部分品牌 NAS 的 ACL 层对容器进程只认 other 权限位：即便宿主机同 uid 可写，
    # 容器内仍会报 "unable to open database file"。放开 other 位后正常。
    chmod -R 777 "${DATA_PATH:-./data}" 2>/dev/null || true

    echo "==> 构建镜像（首次约 3-6 分钟）"
    $DC build

    echo "==> 启动服务"
    $DC up -d

    echo "==> 等待健康检查"
    ok=0
    for i in $(seq 1 40); do
      status=$(docker inspect --format='{{.State.Health.Status}}' "$APP_NAME" 2>/dev/null || echo unknown)
      if [ "$status" = "healthy" ]; then ok=1; break; fi
      printf "."
      sleep 2
    done
    echo ""

    if [ "$ok" = "1" ]; then
      IP=$(hostname -I 2>/dev/null | awk '{print $1}')
      PORT=$(grep '^APP_PORT=' .env | cut -d= -f2)
      echo "=================================================="
      echo " 部署成功"
      echo " 访问地址：http://${IP:-NAS的IP}:${PORT:-3080}"
      echo " 数据文件：${DATA_PATH:-./data}/workflow.db"
      echo "=================================================="
      echo ""
      echo "首次登录后请依次完成："
      echo "  1. 系统设置 → 修改密码"
      echo "  2. 系统设置 → 大模型接入 → 填写接口地址与 API Key → 测试连接"
      echo "  3. 系统设置 → Obsidian 知识库 → 填写 /vault → 检测路径"
      echo "  4. 用户管理 → 为同事创建账号"
    else
      echo "启动异常，健康接口返回："
      docker exec "$APP_NAME" curl -s http://127.0.0.1:3080/api/health 2>/dev/null || true
      echo ""
      echo "最近日志："
      $DC logs --tail=40
      exit 1
    fi
    ;;

  update)
    check_docker
    echo "==> 拉取最新代码"
    git pull --ff-only 2>/dev/null || echo "（非 git 目录或拉取失败，跳过）"
    echo "==> 重建镜像"
    $DC build
    $DC up -d
    docker image prune -f
    echo "==> 更新完成"
    ;;

  backup)
    . ./.env 2>/dev/null || true
    STAMP=$(date +%Y%m%d-%H%M%S)
    OUT="./backup-${STAMP}.tar.gz"
    echo "==> 打包数据目录到 $OUT"
    tar czf "$OUT" -C "$(dirname "${DATA_PATH:-./data}")" "$(basename "${DATA_PATH:-./data}")"
    echo "==> 完成：$OUT（$(du -h "$OUT" | cut -f1)）"
    echo "提示：WAL 模式下 workflow.db-wal 含最近事务，必须与主库一同备份，本脚本已包含。"
    ;;

  logs)
    check_docker
    $DC logs -f --tail=100
    ;;

  stop)
    check_docker
    $DC down
    ;;

  reset-pwd)
    if [ -z "$2" ] || [ -z "$3" ]; then
      echo "用法：./deploy.sh reset-pwd <用户名> <新密码>"
      exit 1
    fi
    echo "==> 重置用户 $2 的密码"
    docker exec "$APP_NAME" node -e "
      const { DatabaseSync } = require('node:sqlite');
      const crypto = require('node:crypto');
      const db = new DatabaseSync('/app/data/workflow.db');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(process.argv[1], salt, 64).toString('hex');
      const r = db.prepare('UPDATE users SET password_hash = ? WHERE username = ?')
        .run(salt + ':' + hash, process.argv[2]);
      if (r.changes === 0) { console.error('用户不存在'); process.exit(1); }
      db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)')
        .run(process.argv[2]);
      console.log('密码已重置，请用新密码登录');
    " "$3" "$2"
    ;;

  *)
    echo "用法：$0 {up|update|backup|logs|stop|reset-pwd <用户名> <密码>}"
    exit 1
    ;;
esac
