CREATE DATABASE IF NOT EXISTS fridge_ai
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE fridge_ai;

CREATE TABLE IF NOT EXISTS kucun (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  fenlei VARCHAR(50) DEFAULT NULL,
  shuliang DECIMAL(12, 3) NOT NULL,
  expire_date DATE DEFAULT NULL,
  location VARCHAR(50) DEFAULT NULL,
  source VARCHAR(20) NOT NULL,
  image_path VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_fefo (name, expire_date, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kucun_log (
  id INT NOT NULL AUTO_INCREMENT,
  kucun_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  fenlei VARCHAR(50) DEFAULT NULL,
  shuliang DECIMAL(12, 3) NOT NULL,
  expire_date DATE DEFAULT NULL,
  action VARCHAR(10) NOT NULL,
  dtime DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  reason VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_kucun_id (kucun_id),
  INDEX idx_name_dtime (name, dtime)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
