# AdvScribbl VPS Deployment Guide

This guide contains the exact commands you need to run on your InterServer VPS to host **AdvScribbl** on `https://advscribbl.co.in`.

## Prerequisites
1. You have purchased an InterServer VPS (Ubuntu 22.04 or 24.04).
2. You can SSH into your VPS: `ssh root@162.35.184.176`.
3. You have logged into your domain registrar (where you bought `advscribbl.co.in`) and pointed the **A Record** to your `162.35.184.176`.

---

## Step 1: Install System Dependencies
Run these commands to install Nginx, Node.js (v20), PM2, and Certbot.

```bash
# Update the system
sudo apt update && sudo apt upgrade -y

# Install Nginx and Certbot
sudo apt install nginx certbot python3-certbot-nginx -y

# Install Node.js v20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs -y

# Install PM2 globally
sudo npm install -g pm2
```

## Step 2: Clone the Project
Clone your repository into the `/var/www/` directory.

```bash
cd /var/www
# Assuming your repository is public. If private, you'll need a personal access token.
sudo git clone https://github.com/ganesh-bhusam/GDFGDFGFDGFDGFGDF advscribbl
cd advscribbl
```

## Step 3: Setup the Backend
Install the Node.js packages and start the backend using PM2.

```bash
cd backend

# Install dependencies
npm install

# Create the environment file
cat <<EOF > .env
PORT=8001
ALLOWED_ORIGINS=https://advscribbl.co.in,http://advscribbl.co.in
ADMIN_SECRET=your_super_secret_password_here
SUPPORT_EMAIL=support@advscribbl.co.in
EOF

# Start the backend server with PM2
pm2 start server.js --name advscribbl-backend

# Save PM2 so it restarts if the VPS reboots
pm2 save
pm2 startup
# (Run the command PM2 prints out here, if any)
```

## Step 4: Configure Nginx (Web Server & Reverse Proxy)
We need to tell Nginx to serve your frontend files and proxy the API/Socket requests to your Node.js backend.

```bash
# Create an Nginx config file for your domain
sudo nano /etc/nginx/sites-available/advscribbl
```

Paste the following configuration into the file:

```nginx
server {
    listen 80;
    server_name advscribbl.co.in www.advscribbl.co.in;

    # Serve the frontend files directly
    root /var/www/advscribbl/frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API and Socket.io traffic to the backend
    location /api/ {
        proxy_pass http://localhost:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

```bash
# Enable the configuration
sudo ln -s /etc/nginx/sites-available/advscribbl /etc/nginx/sites-enabled/

# Test the config for syntax errors
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

## Step 5: Secure with SSL (HTTPS)
Run Certbot to automatically fetch and configure an SSL certificate. **Your domain's A Record MUST point to the VPS IP before running this step.**

```bash
sudo certbot --nginx -d advscribbl.co.in -d www.advscribbl.co.in
```
Follow the prompts (enter your email, agree to terms). Certbot will automatically modify your Nginx config to use HTTPS.

---

## Maintenance Commands

**To update the code when you push new changes to Github:**
```bash
cd /var/www/advscribbl
git pull
cd backend
npm install
pm2 restart advscribbl-backend
```

**To view backend logs:**
```bash
pm2 logs advscribbl-backend
```
