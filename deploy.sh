#!/bin/bash
sudo cp api/api.py /var/www/gitapi/api.py
sudo cp dashboard/index.html /var/www/gitdash/index.html
sudo cp apache/gitweb.conf /etc/httpd/conf.d/gitweb.conf
sudo cp apache/gitweb.app.conf /etc/gitweb.conf
sudo chmod 755 /var/www/gitapi/api.py
sudo systemctl reload httpd