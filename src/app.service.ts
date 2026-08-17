import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health() {
    return {
      status: 'ok',
      service: 'Sami Furniture Accountant API',
      uptime: process.uptime(),
    };
  }
}
