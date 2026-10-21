-- ========== 流感可视化数据表 ==========
-- 在 MySQL 中执行本脚本即可建库建表并写入模拟数据
-- 执行方式：mysql -u root -p < init_influenza.sql

CREATE DATABASE IF NOT EXISTS influenza_db DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE influenza_db;

-- 年度汇总：一年一行
CREATE TABLE IF NOT EXISTS flu_yearly (
  year       smallint     NOT NULL COMMENT '年度',
  cases      int          NOT NULL COMMENT '流感样病例(万人次)',
  rate       decimal(4,2) NOT NULL COMMENT '流感样病例比例 ILI%',
  pos_rate   decimal(4,2) NOT NULL COMMENT '实验室阳性率 %',
  peak_week  tinyint      NOT NULL COMMENT '季节峰值周',
  samples    int          NOT NULL COMMENT '阳性样本数',
  PRIMARY KEY (year)
) ENGINE=InnoDB COMMENT='年度流感汇总';

-- 月度趋势：一年 12 行
CREATE TABLE IF NOT EXISTS flu_monthly (
  year  smallint     NOT NULL COMMENT '年度',
  month tinyint      NOT NULL COMMENT '月份 1-12',
  rate  decimal(4,2) NOT NULL COMMENT '当月 ILI%',
  PRIMARY KEY (year, month),
  CONSTRAINT fk_month_year FOREIGN KEY (year) REFERENCES flu_yearly (year)
) ENGINE=InnoDB COMMENT='月度流感活动趋势';

-- 地区系数：一年 5 行，各地区相对全国的倍数
CREATE TABLE IF NOT EXISTS flu_region (
  year   smallint     NOT NULL COMMENT '年度',
  region varchar(16)  NOT NULL COMMENT '地区',
  factor decimal(4,2) NOT NULL COMMENT '相对全国的活动系数',
  PRIMARY KEY (year, region),
  CONSTRAINT fk_region_year FOREIGN KEY (year) REFERENCES flu_yearly (year)
) ENGINE=InnoDB COMMENT='各年度地区活动系数';

-- 年龄组系数：与年度无关，共 5 行
CREATE TABLE IF NOT EXISTS flu_age_group (
  `group`  varchar(16)  NOT NULL COMMENT '年龄组',
  factor   decimal(4,2) NOT NULL COMMENT '相对全部年龄的活动系数',
  PRIMARY KEY (`group`)
) ENGINE=InnoDB COMMENT='年龄组活动系数';

-- ---------- 数据：年度汇总 ----------
INSERT INTO flu_yearly (year, cases, rate, pos_rate, peak_week, samples) VALUES
  (2025, 4286, 4.70, 17.80,  6, 12846),
  (2024, 4678, 4.40, 19.90,  8, 14120),
  (2023, 5130, 5.20, 22.60, 11, 15944),
  (2022, 2814, 3.10, 10.80, 52,  7620),
  (2021, 2430, 2.80,  8.90, 50,  6188)
ON DUPLICATE KEY UPDATE cases = VALUES(cases);

-- ---------- 数据：月度趋势 ----------
INSERT INTO flu_monthly (year, month, rate) VALUES
  (2025,1,5.8),(2025,2,7.1),(2025,3,5.3),(2025,4,3.2),(2025,5,2.4),(2025,6,2.1),
  (2025,7,2.0),(2025,8,2.2),(2025,9,2.8),(2025,10,3.6),(2025,11,4.5),(2025,12,6.4),
  (2024,1,5.1),(2024,2,6.4),(2024,3,5.8),(2024,4,3.8),(2024,5,2.7),(2024,6,2.2),
  (2024,7,2.1),(2024,8,2.4),(2024,9,3.1),(2024,10,4.3),(2024,11,5.7),(2024,12,7.2),
  (2023,1,4.4),(2023,2,5.1),(2023,3,6.8),(2023,4,7.4),(2023,5,4.8),(2023,6,3.1),
  (2023,7,2.7),(2023,8,3.2),(2023,9,4.9),(2023,10,6.2),(2023,11,8.1),(2023,12,7.0),
  (2022,1,2.2),(2022,2,2.1),(2022,3,1.9),(2022,4,1.7),(2022,5,1.8),(2022,6,2.3),
  (2022,7,2.8),(2022,8,3.0),(2022,9,2.6),(2022,10,2.9),(2022,11,3.8),(2022,12,5.9),
  (2021,1,1.8),(2021,2,1.7),(2021,3,1.6),(2021,4,1.5),(2021,5,1.7),(2021,6,2.0),
  (2021,7,2.4),(2021,8,2.6),(2021,9,2.8),(2021,10,3.1),(2021,11,4.2),(2021,12,5.2)
ON DUPLICATE KEY UPDATE rate = VALUES(rate);

-- ---------- 数据：地区系数 ----------
INSERT INTO flu_region (year, region, factor) VALUES
  (2025,'全国',1.00),(2025,'华东',1.08),(2025,'华南',0.90),(2025,'华北',1.12),(2025,'西南',0.84),
  (2024,'全国',1.00),(2024,'华东',1.02),(2024,'华南',0.82),(2024,'华北',1.18),(2024,'西南',0.89),
  (2023,'全国',1.00),(2023,'华东',1.11),(2023,'华南',0.94),(2023,'华北',1.06),(2023,'西南',0.86),
  (2022,'全国',1.00),(2022,'华东',1.04),(2022,'华南',1.12),(2022,'华北',0.93),(2022,'西南',0.88),
  (2021,'全国',1.00),(2021,'华东',0.97),(2021,'华南',1.08),(2021,'华北',0.91),(2021,'西南',0.86)
ON DUPLICATE KEY UPDATE factor = VALUES(factor);

-- ---------- 数据：年龄组系数 ----------
INSERT INTO flu_age_group (`group`, factor) VALUES
  ('全部年龄', 1.00),
  ('0–4岁',    1.34),
  ('5–14岁',   1.48),
  ('15–59岁',  0.82),
  ('60岁及以上', 1.13)
ON DUPLICATE KEY UPDATE factor = VALUES(factor);
