-- ========== 第 6 讲：test_db 数据库 ==========
-- 讲义中 db_test.py 连接的就是这个库，查询 student 表
-- 执行方式：mysql -u root -p < init_test_db.sql

CREATE DATABASE IF NOT EXISTS test_db DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE test_db;

CREATE TABLE IF NOT EXISTS student (
  id        int          NOT NULL AUTO_INCREMENT COMMENT '主键',
  name      varchar(32)  NOT NULL COMMENT '姓名',
  sno       varchar(16)  NOT NULL COMMENT '学号',
  major     varchar(32)  NOT NULL COMMENT '专业',
  class_name varchar(32) NOT NULL COMMENT '班级',
  age       tinyint      DEFAULT NULL COMMENT '年龄',
  gender    char(1)      DEFAULT NULL COMMENT '性别：男/女',
  phone     varchar(20)  DEFAULT NULL COMMENT '手机号',
  created_at datetime    DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_sno (sno)
) ENGINE=InnoDB COMMENT='学生信息表';

INSERT INTO student (name, sno, major, class_name, age, gender, phone) VALUES
  ('杨子成', '2024212993', '大数据', '大数据一班', 20, '男', '13800000001'),
  ('may',    '2024212994', '大数据', '大数据一班', 20, '女', '13800000002'),
  ('张三',   '2024212995', '计算机', '计科一班',   21, '男', '13800000003'),
  ('李四',   '2024212996', '计算机', '计科二班',   21, '女', '13800000004'),
  ('王五',   '2024212997', '软件工程', '软工一班', 19, '男', '13800000005')
ON DUPLICATE KEY UPDATE major = VALUES(major);
