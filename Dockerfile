FROM php:8.2-apache

# Install PDO MySQL extension (required for database connection)
RUN docker-php-ext-install pdo pdo_mysql

# Enable Apache mod_rewrite (required for .htaccess routing)
RUN a2enmod rewrite

# Set the working directory
WORKDIR /var/www/html

# Copy the API source code to the Apache document root
COPY . /var/www/html/

# Ensure proper permissions for Apache
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html

EXPOSE 80
