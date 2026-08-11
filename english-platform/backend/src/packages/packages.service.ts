import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Package, PackageStatus } from './package.entity';
import { CreatePackageDto } from './dto/create-package.dto';

@Injectable()
export class PackagesService {
  constructor(
    @InjectRepository(Package)
    private packagesRepository: Repository<Package>,
  ) {}

  async findAll(admin = false) {
    const where = admin ? {} : { status: PackageStatus.ACTIVE };
    return this.packagesRepository.find({ where, order: { created_at: 'DESC' } });
  }

  async findById(id: string) {
    const pkg = await this.packagesRepository.findOne({ where: { id } });
    if (!pkg) throw new NotFoundException('课包不存在');
    return pkg;
  }

  async create(dto: CreatePackageDto) {
    const pkg = this.packagesRepository.create(dto);
    return this.packagesRepository.save(pkg);
  }

  async update(id: string, dto: Partial<CreatePackageDto>) {
    const pkg = await this.findById(id);
    Object.assign(pkg, dto);
    return this.packagesRepository.save(pkg);
  }

  async updateStatus(id: string, status: PackageStatus) {
    const pkg = await this.findById(id);
    pkg.status = status;
    return this.packagesRepository.save(pkg);
  }
}
