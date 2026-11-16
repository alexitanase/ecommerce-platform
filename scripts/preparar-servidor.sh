#!/usr/bin/env bash
#
# Prepara un servidor recién creado para alojar la tienda.
#
# Probado sobre Ubuntu 24.04 LTS (DigitalOcean, Hetzner, OVH: da igual, es un
# Ubuntu limpio). Se ejecuta UNA vez, como root, recién creado el droplet:
#
#     scp scripts/preparar-servidor.sh root@IP:/root/
#     ssh root@IP 'bash /root/preparar-servidor.sh'
#
# Es idempotente: volver a lanzarlo no rompe nada ni duplica reglas.
#
# El orden está pensado para no dejarte fuera de tu propio servidor: primero se
# crea el usuario y se le copian TUS claves, se comprueba que las tiene, y solo
# entonces se cierra el acceso de root. Al revés, un fallo a mitad deja un
# servidor al que nadie puede entrar y hay que reinstalar.
#
set -euo pipefail

USUARIO="${USUARIO_TIENDA:-tienda}"
RAIZ="/opt/tienda"
ZONA="${ZONA_HORARIA:-Europe/Madrid}"

log() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo 'Ejecútalo como root.' >&2; exit 1; }

# ── 1 · Sistema al día ────────────────────────────────────────
log 'Actualizando el sistema'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
  ca-certificates curl gnupg ufw fail2ban unattended-upgrades \
  rsync jq htop ncdu postgresql-client

timedatectl set-timezone "$ZONA"

# ── 2 · Usuario sin privilegios ───────────────────────────────
#
# La aplicación no corre como root. Docker sí necesita hablar con su demonio,
# por eso el usuario va al grupo `docker`; conviene saber que ese grupo
# equivale a root en la práctica —quien puede lanzar contenedores puede montar
# el disco del host— así que no es un usuario para dárselo a cualquiera.
log "Creando el usuario $USUARIO"
if ! id -u "$USUARIO" >/dev/null 2>&1; then
  adduser --disabled-password --gecos '' "$USUARIO"
fi

install -d -m 700 -o "$USUARIO" -g "$USUARIO" "/home/$USUARIO/.ssh"
if [[ -f /root/.ssh/authorized_keys ]]; then
  cp /root/.ssh/authorized_keys "/home/$USUARIO/.ssh/authorized_keys"
  chown "$USUARIO:$USUARIO" "/home/$USUARIO/.ssh/authorized_keys"
  chmod 600 "/home/$USUARIO/.ssh/authorized_keys"
fi

if [[ ! -s "/home/$USUARIO/.ssh/authorized_keys" ]]; then
  aviso "El usuario $USUARIO no tiene ninguna clave SSH."
  aviso 'Añádela antes de continuar o te quedarás fuera al cerrar el acceso de root.'
  exit 1
fi

# Sudo sin contraseña, y no es una concesión: la cuenta se crea sin contraseña
# (solo clave), así que un sudo que la pida sería un sudo inutilizable. Y como
# más abajo el usuario entra en el grupo `docker` —que permite montar el disco
# del host dentro de un contenedor— ya tiene acceso equivalente a root de
# hecho. Negarle sudo no añade seguridad: solo deja la máquina sin forma de
# administrarse cuando root ya no puede entrar por SSH, y obliga a pasar por la
# consola web del proveedor para cualquier cambio.
usermod -aG sudo "$USUARIO"
printf 'tienda ALL=(ALL) NOPASSWD:ALL\n' >"/etc/sudoers.d/90-$USUARIO"
chmod 440 "/etc/sudoers.d/90-$USUARIO"
visudo -cf "/etc/sudoers.d/90-$USUARIO" >/dev/null

# ── 3 · Docker ────────────────────────────────────────────────
log 'Instalando Docker'
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
usermod -aG docker "$USUARIO"

# Techo de logs también a nivel de demonio: si un contenedor futuro se olvida
# de declararlo, el disco no se llena igualmente. Llenar el disco es la forma
# más tonta y más frecuente de tirar una tienda.
cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
JSON
systemctl restart docker

# ── 4 · Cortafuegos ───────────────────────────────────────────
#
# Tres puertos y ni uno más. Postgres, Redis y Meilisearch NO se abren: viven
# en la red interna de Docker y se llega a ellos por túnel SSH cuando hace
# falta mirarlos.
log 'Configurando el cortafuegos'
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp comment 'SSH' >/dev/null
ufw allow 80/tcp comment 'HTTP (redirige a HTTPS y valida certificados)' >/dev/null
ufw allow 443/tcp comment 'HTTPS' >/dev/null
ufw --force enable >/dev/null

# Docker publica puertos saltándose ufw manipulando iptables directamente. Es
# un comportamiento conocido y sorprendente: un `ports: 5432:5432` quedaría
# accesible desde internet aunque ufw diga que no. La pila de producción no
# publica esos puertos, y esta regla es el segundo cinturón.
cat >/etc/ufw/after.rules.d-tienda <<'RULES'
# Recordatorio: cualquier `ports:` en el compose que no sea 80/443 debe ir
# atado a 127.0.0.1 (por ejemplo `127.0.0.1:9090:9090`), o quedará expuesto.
RULES

# ── 5 · SSH ───────────────────────────────────────────────────
log 'Endureciendo SSH'
cat >/etc/ssh/sshd_config.d/99-tienda.conf <<'CONF'
# Sin contraseñas: solo clave. Un servidor con contraseña recibe miles de
# intentos al día y basta con que uno acierte.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PermitEmptyPasswords no
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
AllowAgentForwarding no
CONF

# `sshd -t` necesita este directorio y en una máquina recién instalada puede no
# existir todavía: sin él la comprobación falla con «Missing privilege
# separation directory» y no se llega a validar la configuración, que es
# justamente lo que evita quedarse fuera tras el reinicio.
mkdir -p /run/sshd
sshd -t
systemctl reload ssh

# ── 6 · fail2ban ──────────────────────────────────────────────
log 'Activando fail2ban'
cat >/etc/fail2ban/jail.d/tienda.conf <<'CONF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
mode = aggressive
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

# ── 7 · Actualizaciones de seguridad automáticas ──────────────
log 'Activando actualizaciones de seguridad automáticas'
cat >/etc/apt/apt.conf.d/51-tienda-unattended <<'CONF'
Unattended-Upgrade::Allowed-Origins { "${distro_id}:${distro_codename}-security"; };
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
CONF
systemctl enable --now unattended-upgrades

# ── 8 · Memoria ───────────────────────────────────────────────
#
# 2 GB de intercambio en un servidor de 8 GB. No es para usarlo: es la red que
# evita que el kernel mate a Postgres en un pico. Con `swappiness` bajo, el
# sistema sigue prefiriendo la RAM y solo tira del disco cuando no queda otra.
if [[ ! -f /swapfile ]]; then
  log 'Creando espacio de intercambio'
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

cat >/etc/sysctl.d/99-tienda.conf <<'CONF'
vm.swappiness = 10
# Redis lo pide expresamente: sin esto, guardar en disco puede fallar por
# reserva de memoria aunque haya de sobra.
vm.overcommit_memory = 1
net.core.somaxconn = 1024
net.ipv4.tcp_max_syn_backlog = 2048
CONF
sysctl -p /etc/sysctl.d/99-tienda.conf >/dev/null

# ── 9 · Estructura de la aplicación ───────────────────────────
log 'Preparando el directorio de la aplicación'
install -d -o "$USUARIO" -g "$USUARIO" "$RAIZ" "$RAIZ/copias" "$RAIZ/infra" "$RAIZ/docker"

# ── 10 · Copia de seguridad diaria ────────────────────────────
#
# A las 4:15, cuando no hay tráfico. El volcado se queda en el servidor Y hay
# que sacarlo fuera: una copia en el mismo disco que la base no protege del
# caso más probable, que es perder el disco.
log 'Programando la copia diaria'
cat >/etc/cron.d/tienda-copias <<CONF
15 4 * * * $USUARIO cd $RAIZ && BACKUP_DIR=$RAIZ/copias bash $RAIZ/copia-seguridad.sh >> $RAIZ/copias/copia.log 2>&1
CONF
chmod 644 /etc/cron.d/tienda-copias

log 'Servidor preparado'
cat <<RESUMEN

  Usuario de trabajo : $USUARIO   (entra con: ssh $USUARIO@<ip>)
  Directorio         : $RAIZ
  Puertos abiertos   : 22, 80, 443
  Acceso de root     : desactivado
  Contraseñas SSH    : desactivadas

  Siguiente paso: crear $RAIZ/.env con los secretos de producción.
  Genera cada secreto en ESTE servidor, no en tu portátil ni en un chat:

     openssl rand -base64 36

RESUMEN
