import { redirect } from 'next/navigation';

/** 后台首页默认落到首要工位：提现队列。 */
export default function AdminIndexPage() {
  redirect('/admin/withdrawals');
}
