/** 浏览器注入钱包（MetaMask 等 EIP-1193 provider）的最小封装。 */

export interface EthereumProvider {
  isMetaMask?: boolean;
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function hasWallet(): boolean {
  return typeof window !== 'undefined' && !!window.ethereum;
}

/** 请求连接钱包并返回首个地址；无钱包 / 用户拒绝时返回 null（走手动兜底）。 */
export async function connectWallet(): Promise<string | null> {
  if (!hasWallet()) return null;
  try {
    const accounts = (await window.ethereum!.request({
      method: 'eth_requestAccounts',
    })) as string[];
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}

/** personal_sign(message, address)；无钱包 / 拒绝签名时返回 null。 */
export async function personalSign(
  message: string,
  address: string,
): Promise<string | null> {
  if (!hasWallet()) return null;
  try {
    return (await window.ethereum!.request({
      method: 'personal_sign',
      params: [message, address],
    })) as string;
  } catch {
    return null;
  }
}
