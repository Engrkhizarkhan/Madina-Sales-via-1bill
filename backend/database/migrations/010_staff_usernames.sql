ALTER TABLE users MODIFY email VARCHAR(190) NULL;
UPDATE users SET force_password_change = 0 WHERE role <> 'admin' AND force_password_change = 1;
