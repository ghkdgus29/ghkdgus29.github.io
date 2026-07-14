---
layout: post
author: Hyun 
title: 홈 서버 구축기 
date:   2026-07-14 19:19:00 +0900
excerpt: "홈 서버 구축기"
categories:
 - Engineering
 - Infra
 - Docker
lang: kr
lang_ref: /Building-a-Homelab-Server-with-Cloudflare-Tunnel-and-Tailscale-EN/
---

# 배경
사이드 프로젝트에 사용하고 있던 AWS 프리티어를 사용하고 있었는데, 프리티어와의 이별은 갑작스레 찾아왔다. 
사실 그 전부터 서버 비용을 줄이려고 AWS 람다나 다른 클라우드 서비스로 옮기는 걸 고민하고 있었는데, 프리티어 크레딧을 예상보다 빠르게 다 써버려서, 결정을 앞당겨야 했다.

그러다 문득, 개발자라면 한 번쯤 홈서버를 구축해보는 것도 낭만있겠다는 생각이 들었다. 마침 집에서 놀고 있는 윈도우 노트북도 있어서, 결국 다른 클라우드로 옮기는 대신 홈서버를 구축하기로 결정했다.

<br>

# 완성된 홈서버 구조
- OS: Ubuntu Server 26.04 LTS 
- 외부 노출: Cloudflare Tunnel 
- SSH 접근: Tailscale 
- 배포: GitHub Actions → Docker Hub 빌드 → Tailscale로 서버 접속 → 배포

```
[웹 방문자] → Cloudflare(DNS) → cloudflared 컨테이너 (Cloudflare Tunnel) → nginx 컨테이너 → 각 서비스 컨테이너
[GitHub Actions] → Tailscale 사설망 → SSH → 홈 서버 
```
> 전체 트래픽 흐름

포트포워딩 없이 외부에는 Cloudflare Tunnel로만 애플리케이션을 노출하고, SSH는 Tailscale 사설망을 통해서만 접속하도록 구성했다. 

<br>

# 구축 과정

<br>

## Ubuntu Server 설치
윈도우는 홈서버로 쓰기엔 불편할 것 같았고, 무엇보다 리눅스가 더 낭만있다고 생각해서 윈도우를 밀어버리고 Ubuntu Server를 설치하기로 했다.

먼저 ubuntu.com/download/server에서 Ubuntu Server 26.04 LTS ISO를 받고, 윈도우 노트북에서 Rufus로 부팅 USB를 만들었다.

USB를 꽂은 채로 노트북을 켜고 F2를 눌러 BIOS로 진입한 뒤,
- Secure Boot 비활성화
- Boot Priority를 부팅 USB가 우선하도록 변경

두 가지를 설정하고 저장 후 재부팅한다. 이후엔 부팅 USB로 우분투 설치 마법사가 뜨고, 그대로 따라가면서 우분투 리눅스 설치를 진행하면 된다.

<br>

## 서버 기본 설정

<br>

### SSH 데몬 설치
```bash
sudo apt update
sudo apt install openssh-server -y
sudo systemctl enable --now ssh
systemctl status ssh   # active (running) 확인
```

<br>

### 방화벽에 SSH 포트 허용
뒤에서 Tailscale 전용으로 SSH 접근을 좁힐 예정이지만, 지금 당장은 초기 접속을 위해 우선 열어둔다.
```bash
sudo ufw allow OpenSSH
```

`ip a`로 홈서버 IP를 확인한 뒤, 메인으로 쓰는 맥북에서 `ssh 홈서버계정명@홈서버IP`로 접속해서 이후 작업을 진행했다.

<br>

### 시스템 업데이트
```bash
sudo apt update && sudo apt upgrade -y
sudo reboot
```

<br>

### 노트북 전원 관리
노트북을 서버로 쓰는 만큼, 뚜껑을 닫아도 절전모드로 빠지지 않도록 설정이 필요했다.
```bash
sudo vim /etc/systemd/logind.conf
```
```
HandleLidSwitch=ignore
HandleLidSwitchDocked=ignore
HandleLidSwitchExternalPower=ignore
```
```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
sudo systemctl restart systemd-logind
```

<br>

### SSH 키 인증으로 전환
메인 맥북에서 SSH 키 쌍을 생성하고, 공개키를 홈서버로 전송했다.
```bash
ssh-keygen -t ed25519 -f ~/.ssh/<key_name> -C "<key_comment>"
ssh-copy-id -i ~/.ssh/<key_name>.pub 계정명@홈서버IP 
```
> ssh-copy-id는 비밀번호로 로그인이 가능한 계정에서만 사용 가능하다.

<br>

### SSH 비밀번호 로그인 막기
```bash
sudo vim /etc/ssh/sshd_config
```
```
PasswordAuthentication no
```
> 값 변경

```bash
sudo sshd -t   # 문법 체크
sudo systemctl restart ssh
```

<br>

## 도커 설치
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exit   # 도커 그룹 권한 적용 위해 재접속
```
```bash
docker run hello-world
```
> 설치 확인

<br>

## 도메인 연결
가비아에서 산 도메인의 네임서버를 Cloudflare로 변경해서, DNS 관리와 Tunnel 기능을 모두 Cloudflare에서 처리할 수 있도록 했다.

Cloudflare 대시보드의 Domains > Overview > Add domain에서 가비아에서 산 도메인을 등록했다. 이때 기존 레코드는 전부 제거하고 등록해야한다. 기존 레코드가 남아있지 않아야 이후 Cloudflare Tunnel에서 이 도메인을 홈서버의 애플리케이션 컨테이너와 매핑할 수 있다.

등록이 끝나면 가비아 쪽에서도 도메인의 네임서버 기존값을 지우고, Cloudflare가 발급해준 네임서버로 교체해준다.

```bash
dig NS 도메인이름 @1.1.1.1
```
> DNS 적용 확인

<br>

## Cloudflare Tunnel
홈서버를 포트포워딩 없이 외부로 노출하기 위해 사용했다.

- Cloudflare 대시보드 → Zero Trust > Networks > Connectors > Create a tunnel
- Docker 선택하여 진행
- 터널을 만들면서, 가비아에서 산 도메인이 nginx로 라우팅되도록 설정

![Cloudflare Tunnel 설정 화면](/assets/images/posts/260714.png)
> Cloudflare Tunnel 커넥터 설정

홈서버에는 cloudflared 서비스와 nginx 서비스, 그리고 애플리케이션이 쓰는 Qdrant, MySQL 서비스들과 같은 인프라 서비스들은, 도커 컴포즈로 함께 구성한 뒤 컨테이너를 올렸다.

```yml
services:
  nginx:
    image: nginx:alpine
    container_name: nginx
    restart: unless-stopped
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro

  cloudflared:
      image: cloudflare/cloudflared:latest
      container_name: cloudflared
      restart: unless-stopped
      command: tunnel --no-autoupdate run
      environment:
        - TUNNEL_TOKEN=...

  qdrant:
    container_name: meow-qdrant
    image: qdrant/qdrant:latest
    restart: unless-stopped
    volumes:
      - qdrant_data:/qdrant/storage

  mysql:
    container_name: meow-mysql
    image: mysql:8.0
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ..
      MYSQL_DATABASE: ..
      MYSQL_USER: ..
      MYSQL_PASSWORD: ..
      MYSQL_CHARSET: utf8mb4
    command: --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
    volumes:
      - mysql_data:/var/lib/mysql

networks:
  default:
    name: meow-network

volumes:
  qdrant_data:
  mysql_data:
```
> docker-compose.yml

`~/nginx/conf.d/default.conf`에는 nginx 프록시 서버가 각 애플리케이션으로 요청을 포워딩하도록 구성했다.

```conf
server {
    listen 80;
    server_name _;

    # Streamlit 관리 UI (사람이 브라우저로 접속, 자체 비밀번호 인증 있음)
    # baseUrlPath=/admin 으로 떠 있으므로 prefix를 유지한 채 그대로 전달
    location /admin/ {
        proxy_pass http://meow-streamlit:8501;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Streamlit은 WebSocket으로 화면을 갱신하므로 업그레이드 헤더 필수
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # FastAPI의 admin REST API — 외부 호출은 막고 meow-streamlit 컨테이너의 호출만 가능
    # 내부망 호출(meow-streamlit → meow-content:8000)은 nginx를 거치지 않으므로 영향 없음
    location ~ ^/api/v1/admin(/|$) {
        deny all;
        return 403;
    }

    # 그 외 공개 API
    location / {
        proxy_pass http://meow-content:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
> nginx/conf.d/default.conf

<br>

## Tailscale
관리자 접근을 사설망 안으로 넣어서 보안을 강화했다.

홈서버에 Tailscale 설치 후 로그인하여 사설망에 등록하였다.
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

메인 맥북도 마찬가지로 Tailscale 설치 후 로그인해서 같은 사설망에 등록하였다.

방화벽에서는 Tailscale 인터페이스를 통한 SSH 접근만 남기고 나머지는 전부 제거하여 보안을 강화하였다.
```bash
sudo ufw status numbered
```
```
Anywhere on tailscale0        ALLOW IN
Anywhere (v6) on tailscale0   ALLOW IN
```
> 위 두 개만 남기고 다 제거

```bash
sudo ufw delete N   # 번호가 밀리므로 큰 번호부터 지워야 한다.
```

홈서버에서 `tailscale ip -4`를 실행하면 이 tailnet 안에서만 통하는 홈서버의 tailscale IP를 확인할 수 있다. 이후로는 기존 IP 대신 `ssh 홈서버계정@tailscale_ip`로만 접속한다.

또한, Tailscale 정책 json에는 `tagOwners`를 추가해뒀다. OAuth client로 Tailscale 사설망에 접속하는 기기는 사람이 아니기 때문에, 태그가 있어야만 tailnet에 들어올 수 있다. GitHub Actions 러너는 매번 새로 뜨는 임시 컴퓨터이기 때문에 OAuth client로 들어오게 되는데, 이는 이어서 설명할 CI/CD를 위한 준비 작업이다.

```json
{
  // ...
  "tagOwners": {
    "tag:ci": ["autogroup:admin"],
  },
}
```
> 관리자 권한이 있는 계정만 해당 태그를 발급할 수 있도록 설정

<br>

## GitHub Actions CI/CD 구성

전체 흐름은 다음과 같다.
```
main 브랜치 push
  → (build-and-push) Docker 이미지 빌드 → Docker Hub push
  → (deploy) tailnet에 임시로 합류 → SSH로 홈 서버 접속 → 최신 이미지 pull & 재기동
```

<br>

### 배포 전용 계정 생성
홈 서버에 배포 전용 deploy 계정을 생성한다.
```bash
sudo useradd -m -s /bin/bash deploy
sudo usermod -aG docker deploy
```

<br>

### 배포 전용 SSH 키 생성 및 전송
맥북에서 생성한 뒤 홈서버로 전송한다.
```bash
ssh-keygen -t ed25519 -f ~/.ssh/<key_name> -C "<key_comment>"
scp ~/.ssh/<key_name>.pub <my_account>@<server_ip>:~/key.pub
```
> deploy 계정은 비밀번호가 없는 계정이므로 위에서 사용한 ssh-copy-id를 사용할 수 없다.

<br>

### deploy 계정 정식 등록
앞에서 scp로 전송한 공개키는 내 계정의 홈 디렉토리에 잠시 올려둔 것일 뿐, 아직 deploy 계정과는 아무 관계가 없다. 이 공개키를 deploy 계정의 `authorized_keys`에 등록해야 GitHub Actions이 deploy 계정으로 SSH 로그인을 할 수 있다.

```bash
sudo mkdir -p /home/deploy/.ssh
sudo bash -c 'cat /home/<my_account>/key.pub >> /home/deploy/.ssh/authorized_keys'
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```
- `mkdir -p /home/deploy/.ssh` : deploy 계정의 `.ssh` 디렉토리를 만든다
- `cat ... >> authorized_keys` : 내 계정에 올려둔 공개키를 deploy 계정의 `authorized_keys`에 추가한다
- `chown -R deploy:deploy` : 지금까지 `sudo`로 만든 파일들의 소유자를 deploy 계정으로 바꾼다
- `chmod 700 .ssh`, `chmod 600 authorized_keys` : 권한을 좁혀준다

`sshd`는 SSH 접속 요청을 받아 처리하는 ssh daemon으로, 맨 처음 `openssh-server`를 설치했을 때 함께 설치되어 백그라운드에서 동작한다. `sshd`는 `authorized_keys`나 그 상위 디렉토리(`.ssh`, 홈 디렉토리)의 권한이 소유자 외의 다른 계정에게도 쓰기 권한이 있으면, 그 파일이 조작됐을 수 있다고 보고 키 인증 자체를 거부한다.

리눅스 권한은 소유자(owner) / 그룹(group) / 기타(other) 세 그룹에 대해 각각 읽기·쓰기·실행 3비트(`rwx`)를 주는데, 이 3비트를 숫자로 압축하여 chmod에 넘긴다

```
chmod 700 .ssh
          owner group other
7   =     111   000   000   (rwx / --- / ---)

chmod 600 authorized_keys
          owner group other
6   =     110   000   000   (rw- / --- / ---)
```

`700`과 `600` 모두 group·other 비트가 `000`이다. 즉 deploy 계정(owner) 외에는 `.ssh` 디렉토리와 `authorized_keys` 에 접근할 수 없음을 나타낸다.

<br>

### Tailscale OAuth client 생성
- Tailscale console → settings > Trust credentials > + Credential
- OAuth > All scopes
- client id와 secret 발급받기

<br>

### GitHub Secrets 등록
- `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` : Docker Hub 인증
- `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` : Tailscale OAuth client
- `SSH_PRIVATE_KEY` : `cat ~/.ssh/<key_name>` 전체 내용
- `SERVER_TS_IP` : `tailscale ip -4`로 확인한 홈 서버 주소
- `ENV_FILE_CONTENT` : 앱 `.env` 내용

<br>

### main.yml
```yml
name: CI/CD Pipeline
on:
  push:
    branches: [ "main" ]
jobs:
  build-and-push:
    runs-on: ubuntu-latest

    steps:
    - name: Checkout code
      uses: actions/checkout@v4
    - name: Set up Python
      uses: actions/setup-python@v4
      with:
        python-version: '3.13'
    - name: Login to Docker Hub
      uses: docker/login-action@v3
      with:
        username: ${{ secrets.DOCKERHUB_USERNAME }}
        password: ${{ secrets.DOCKERHUB_TOKEN }}
    - name: Build and push Docker image
      uses: docker/build-push-action@v5
      with:
        context: .
        push: true
        tags: ${{ secrets.DOCKERHUB_USERNAME }}/meow-content:latest

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest

    steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Connect to Tailscale
      uses: tailscale/github-action@v4
      with:
        oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
        oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
        tags: tag:ci

    - name: Copy deploy compose file to homelab
      uses: appleboy/scp-action@v0.1.7
      with:
        host: ${{ secrets.SERVER_TS_IP }}
        username: deploy
        key: ${{ secrets.SSH_PRIVATE_KEY }}
        source: "docker-compose.app.yml"
        target: "~/meow-content/"

    - name: Deploy to homelab via SSH
      uses: appleboy/ssh-action@v1.0.3
      with:
        host: ${{ secrets.SERVER_TS_IP }}
        username: deploy
        key: ${{ secrets.SSH_PRIVATE_KEY }}
        script: |
          cd ~/meow-content

          echo "${{ secrets.ENV_FILE_CONTENT }}" > .env.tmp

          DOCKERHUB_USERNAME=${{ secrets.DOCKERHUB_USERNAME }} \
            docker compose -f docker-compose.app.yml pull

          DOCKERHUB_USERNAME=${{ secrets.DOCKERHUB_USERNAME }} \
            docker compose -f docker-compose.app.yml up -d

          rm -f .env.tmp
```

<br>

### Tailscale이 있는데도 SSH 키가 필요한 이유
Tailscale은 홈서버에 도달할 수 있도록 방화벽 계층을 열어주는 역할이고, SSH 키는 그렇게 도달한 다음 이 계정으로 로그인해도 되는지를 증명하는 역할이다. 둘은 "도달 가능성"과 "인증"이라는 서로 다른 계층을 책임지기 때문에, 하나가 있다고 다른 하나를 생략할 수는 없다.

<br>

# 마무리
Cloudflare Tunnel로 외부 노출을, Tailscale로 관리자 접근을 분리해두니 공유기 설정을 건드릴 일이 없어서 보안 적으로 더욱 안전하다는 마음이 들었다. 또한, AWS 프리티어 인스턴스보다 훨씬 좋은 성능의 서버를 비용 걱정없이 (전기세 빼고) 노트북 한 대로 사용할 수 있게 되어 좋았고, 무엇보다도 직접 홈 서버를 구축한다는 버킷리스트를 이루어서 더욱 좋았다.
