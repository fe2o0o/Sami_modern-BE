import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1784450453491 implements MigrationInterface {
    name = 'InitSchema1784450453491'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`companies\` (\`id\` varchar(36) NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` timestamp(6) NULL, \`version\` int NOT NULL DEFAULT '1', \`code\` varchar(50) NULL, \`name\` varchar(255) NOT NULL, \`name_en\` varchar(255) NULL, \`legal_name\` varchar(255) NULL, \`commercial_registration\` varchar(100) NULL, \`tax_number\` varchar(100) NULL, \`vat_number\` varchar(100) NULL, \`phone\` varchar(30) NULL, \`mobile\` varchar(30) NULL, \`email\` varchar(255) NULL, \`website\` varchar(255) NULL, \`country\` varchar(100) NULL, \`city\` varchar(100) NULL, \`address\` text NULL, \`postal_code\` varchar(20) NULL, \`currency\` varchar(10) NOT NULL DEFAULT 'EGP', \`language\` varchar(10) NOT NULL DEFAULT 'ar', \`timezone\` varchar(60) NOT NULL DEFAULT 'Africa/Cairo', \`fiscal_year_start\` varchar(10) NOT NULL DEFAULT '01-01', \`logo\` varchar(500) NULL, \`notes\` text NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, UNIQUE INDEX \`IDX_80af3e6808151c3210b4d5a218\` (\`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`branches\` (\`id\` varchar(36) NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` timestamp(6) NULL, \`version\` int NOT NULL DEFAULT '1', \`code\` varchar(50) NOT NULL, \`name\` varchar(255) NOT NULL, \`manager_name\` varchar(255) NULL, \`phone\` varchar(30) NULL, \`mobile\` varchar(30) NULL, \`email\` varchar(255) NULL, \`country\` varchar(100) NULL, \`city\` varchar(100) NULL, \`address\` text NULL, \`latitude\` decimal(10,7) NULL, \`longitude\` decimal(10,7) NULL, \`is_main\` tinyint NOT NULL DEFAULT 0, \`is_active\` tinyint NOT NULL DEFAULT 1, \`notes\` text NULL, \`company_id\` varchar(255) NOT NULL, UNIQUE INDEX \`IDX_9c06cbb83feb2f0be6263bd47e\` (\`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`warehouses\` (\`id\` varchar(36) NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` timestamp(6) NULL, \`version\` int NOT NULL DEFAULT '1', \`code\` varchar(50) NOT NULL, \`name\` varchar(255) NOT NULL, \`type\` enum ('store', 'showroom', 'store_showroom') NOT NULL DEFAULT 'store', \`manager_name\` varchar(255) NULL, \`phone\` varchar(30) NULL, \`email\` varchar(255) NULL, \`address\` text NULL, \`allow_negative_stock\` tinyint NOT NULL DEFAULT 0, \`is_default\` tinyint NOT NULL DEFAULT 0, \`is_active\` tinyint NOT NULL DEFAULT 1, \`notes\` text NULL, \`branch_id\` varchar(255) NOT NULL, UNIQUE INDEX \`IDX_d8b96d60ff9a288f5ed862280d\` (\`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`branches\` ADD CONSTRAINT \`FK_5973f79e64a27c506b07cd84b29\` FOREIGN KEY (\`company_id\`) REFERENCES \`companies\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`warehouses\` ADD CONSTRAINT \`FK_d1a87bf9de7503bb1b6fc0cb859\` FOREIGN KEY (\`branch_id\`) REFERENCES \`branches\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`warehouses\` DROP FOREIGN KEY \`FK_d1a87bf9de7503bb1b6fc0cb859\``);
        await queryRunner.query(`ALTER TABLE \`branches\` DROP FOREIGN KEY \`FK_5973f79e64a27c506b07cd84b29\``);
        await queryRunner.query(`DROP INDEX \`IDX_d8b96d60ff9a288f5ed862280d\` ON \`warehouses\``);
        await queryRunner.query(`DROP TABLE \`warehouses\``);
        await queryRunner.query(`DROP INDEX \`IDX_9c06cbb83feb2f0be6263bd47e\` ON \`branches\``);
        await queryRunner.query(`DROP TABLE \`branches\``);
        await queryRunner.query(`DROP INDEX \`IDX_80af3e6808151c3210b4d5a218\` ON \`companies\``);
        await queryRunner.query(`DROP TABLE \`companies\``);
    }

}
