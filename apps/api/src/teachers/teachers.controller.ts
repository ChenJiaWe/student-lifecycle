import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { Roles } from '../auth/auth.decorators';

@Controller('teachers')
@Roles(Role.ADMIN)
export class TeachersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.teacher.findMany({
      where: { active: true },
      select: { id: true, name: true, subjects: true },
      orderBy: { name: 'asc' },
    });
  }
}
