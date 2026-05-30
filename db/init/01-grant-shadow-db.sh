#!/bin/sh
# Prisma Migrate(dev)는 마이그레이션 검증용 임시 "shadow database"를 생성한다.
# 그러려면 앱 유저에게 전역 DB 생성 권한이 필요한데, MARIADB_USER는 기본적으로
# MARIADB_DATABASE 한 곳에만 권한을 받으므로 P3014 오류가 난다.
# 이 스크립트는 새 볼륨 최초 초기화 시 1회 실행되어 전역 권한을 부여한다. (로컬 개발 전용)
set -e

mariadb -u root -p"$MARIADB_ROOT_PASSWORD" <<SQL
GRANT ALL PRIVILEGES ON *.* TO '$MARIADB_USER'@'%';
FLUSH PRIVILEGES;
SQL
