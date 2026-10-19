import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('auth_nonces')
export class AuthNonce {
  @PrimaryColumn({ type: 'varchar', length: 42 })
  address: string;

  @Column({ type: 'varchar', length: 64 })
  nonce: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'boolean', default: false })
  used: boolean;
}
