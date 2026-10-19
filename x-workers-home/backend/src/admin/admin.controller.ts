import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminService } from './admin.service';
import { ReconciliationService } from './reconciliation.service';
import {
  AdminBindingChangeListDto,
  AdminBindingChangeRejectDto,
  AdminDepositClaimDto,
  AdminDepositListDto,
  AdminDisputeListDto,
  AdminDisputeResolveDto,
  AdminOrderListDto,
  AdminPenalizeDto,
  AdminResolveDeliveryDto,
  AdminUserListDto,
  AdminWithdrawalListDto,
  AdminWithdrawalPaidDto,
  AdminWithdrawalRejectDto,
} from './dto/admin.dto';

/** 管理端：全部端点要求 JWT + role=admin。 */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  // ---- 对账 ----
  @Get('reconciliation')
  reconciliationSnapshot() {
    return this.reconciliation.inspect();
  }

  // ---- 提现审核 ----
  @Get('withdrawals')
  listWithdrawals(@Query() query: AdminWithdrawalListDto) {
    return this.admin.listWithdrawals(query.status);
  }

  @Post('withdrawals/:id/approve')
  @HttpCode(200)
  approveWithdrawal(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.admin.approveWithdrawal(id, user.userId);
  }

  @Post('withdrawals/:id/paid')
  @HttpCode(200)
  markWithdrawalPaid(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminWithdrawalPaidDto,
  ) {
    return this.admin.markWithdrawalPaid(id, dto.txHash, user.userId);
  }

  @Post('withdrawals/:id/reject')
  @HttpCode(200)
  rejectWithdrawal(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminWithdrawalRejectDto,
  ) {
    return this.admin.rejectWithdrawal(id, dto.reason, user.userId);
  }

  // ---- 充值认领 ----
  @Get('deposits')
  listDeposits(@Query() query: AdminDepositListDto) {
    return this.admin.listDeposits(query.status);
  }

  @Post('deposits/:id/claim')
  @HttpCode(200)
  claimDeposit(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminDepositClaimDto,
  ) {
    return this.admin.claimDeposit(id, dto, user.userId);
  }

  // ---- 人工待核队列 ----
  @Get('manual-queue')
  manualQueue() {
    return this.admin.manualQueue();
  }

  @Post('slots/:id/resolve-delivery')
  @HttpCode(200)
  resolveDelivery(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminResolveDeliveryDto,
  ) {
    return this.admin.resolveDelivery(id, dto.pass, user.userId);
  }

  @Post('jobs/:id/retry')
  @HttpCode(200)
  retryJob(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.admin.retryJob(id, user.userId);
  }

  // ---- 争议 ----
  @Get('disputes')
  listDisputes(@Query() query: AdminDisputeListDto) {
    return this.admin.listDisputes(query.status);
  }

  @Post('disputes/:id/resolve')
  @HttpCode(200)
  resolveDispute(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminDisputeResolveDto,
  ) {
    return this.admin.resolveDispute(id, dto.ruling, dto.note, user.userId);
  }

  // ---- 抽查 ----
  @Get('orders')
  listOrders(@Query() query: AdminOrderListDto) {
    return this.admin.listOrders(query);
  }

  @Get('orders/:id')
  orderDetail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.admin.orderDetail(id);
  }

  // ---- 罚则 ----
  @Post('orders/:id/penalize')
  @HttpCode(200)
  penalizeOrder(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminPenalizeDto,
  ) {
    return this.admin.penalizeOrder(id, dto.reason, user.userId);
  }

  // ---- 用户管理 ----
  @Get('users')
  listUsers(@Query() query: AdminUserListDto) {
    return this.admin.listUsers(query.q);
  }

  @Post('users/:id/suspend')
  @HttpCode(200)
  suspendUser(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.admin.suspendUser(id, user.userId);
  }

  @Post('users/:id/unsuspend')
  @HttpCode(200)
  unsuspendUser(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.admin.unsuspendUser(id, user.userId);
  }

  // ---- 改绑审核 ----
  @Get('binding-changes')
  listBindingChanges(@Query() query: AdminBindingChangeListDto) {
    return this.admin.listBindingChanges(query.status);
  }

  @Post('binding-changes/:id/approve')
  @HttpCode(200)
  approveBindingChange(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.admin.approveBindingChange(id, user.userId);
  }

  @Post('binding-changes/:id/reject')
  @HttpCode(200)
  rejectBindingChange(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminBindingChangeRejectDto,
  ) {
    return this.admin.rejectBindingChange(id, dto.reason, user.userId);
  }
}
