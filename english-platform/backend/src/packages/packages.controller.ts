import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PackagesService } from './packages.service';
import { CreatePackageDto } from './dto/create-package.dto';
import { PackageStatus } from './package.entity';

@Controller('packages')
export class PackagesController {
  constructor(private packagesService: PackagesService) {}

  @Get()
  async listAll() {
    return this.packagesService.findAll(false); // 公开：只返回 active
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async listAllAdmin() {
    return this.packagesService.findAll(true);
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.packagesService.findById(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async create(@Body() dto: CreatePackageDto) {
    return this.packagesService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async update(@Param('id') id: string, @Body() dto: Partial<CreatePackageDto>) {
    return this.packagesService.update(id, dto);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateStatus(@Param('id') id: string, @Body('status') status: PackageStatus) {
    return this.packagesService.updateStatus(id, status);
  }
}
