import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health() {
    return {
      status: 'ok',
      service: 'FAMRIX API',
      uptime: process.uptime(),
    };
  }
}
