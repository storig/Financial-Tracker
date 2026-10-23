import { CategoryAllocationSlot, Transaction } from '../types/finance';
import { DEFAULT_CATEGORY_SLOTS, sortTransactionsIncreasing } from './financialEngine';
import { INITIAL_SEED_TRANSACTIONS } from './seedData';

export interface UserAccount {
  username: string; // normalized lowercase key
  displayName: string;
  passwordHash: string;
  createdAt: string;
}

export interface UserVaultData {
  transactions: Transaction[];
  categorySlots: CategoryAllocationSlot[];
  activeMonthInput: string;
}

const ACCOUNTS_STORAGE_KEY = 'uft_accounts_registry_v1';
const ACTIVE_SESSION_KEY = 'uft_active_session_user_v1';
const VAULT_PREFIX = 'uft_user_vault_v1_';

/**
 * Deterministic, synchronous hash for zero-dependency client-side account verification.
 */
export function hashCredential(username: string, password: string): string {
  const input = `uft_salt_v1:${username.trim().toLowerCase()}:${password}`;
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export function getRegisteredAccounts(): UserAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore storage read errors
  }

  // Ensure default Demo Account always exists for 1-click preview
  const demoAccount: UserAccount = {
    username: 'demo',
    displayName: 'Demo Account',
    passwordHash: hashCredential('demo', 'demo123'),
    createdAt: '2026-10-01T00:00:00.000Z',
  };
  try {
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify([demoAccount]));
  } catch {
    // Ignore
  }
  return [demoAccount];
}

export function getActiveSessionUser(): UserAccount | null {
  try {
    // Support ?autostart=1 for automated testing or instant preview
    if (typeof window !== 'undefined' && window.location.search.includes('autostart=1')) {
      const accounts = getRegisteredAccounts();
      return accounts[0] || null;
    }
    const activeUsername = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!activeUsername) return null;
    const accounts = getRegisteredAccounts();
    return accounts.find((a) => a.username === activeUsername) || null;
  } catch {
    return null;
  }
}

export function setActiveSessionUser(username: string | null): void {
  try {
    if (!username) {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    } else {
      localStorage.setItem(ACTIVE_SESSION_KEY, username.trim().toLowerCase());
    }
  } catch {
    // Ignore
  }
}

export function registerUserAccount(
  rawUsername: string,
  displayName: string,
  password: string,
  seedDemoTransactions: boolean
): { ok: true; account: UserAccount } | { ok: false; error: string } {
  const username = rawUsername.trim().toLowerCase().replace(/\s+/g, '_');
  if (username.length < 2) {
    return { ok: false, error: 'Username must be at least 2 characters.' };
  }
  if (password.length < 4) {
    return { ok: false, error: 'Password must be at least 4 characters.' };
  }

  const accounts = getRegisteredAccounts();
  if (accounts.some((a) => a.username === username)) {
    return { ok: false, error: `Username "${username}" is already registered on this device.` };
  }

  const newAccount: UserAccount = {
    username,
    displayName: displayName.trim() || rawUsername.trim(),
    passwordHash: hashCredential(username, password),
    createdAt: new Date().toISOString(),
  };

  const nextAccounts = [...accounts, newAccount];
  try {
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(nextAccounts));
  } catch {
    return { ok: false, error: 'Browser storage is full or unavailable.' };
  }

  const initialVault: UserVaultData = {
    transactions: seedDemoTransactions ? INITIAL_SEED_TRANSACTIONS : [],
    categorySlots: DEFAULT_CATEGORY_SLOTS,
    activeMonthInput: '',
  };
  saveUserVault(username, initialVault);
  setActiveSessionUser(username);

  return { ok: true, account: newAccount };
}

export function authenticateUserAccount(
  rawUsername: string,
  password: string
): { ok: true; account: UserAccount } | { ok: false; error: string } {
  const username = rawUsername.trim().toLowerCase();
  if (!username || !password) {
    return { ok: false, error: 'Please enter both username and password.' };
  }

  const accounts = getRegisteredAccounts();
  const account = accounts.find((a) => a.username === username);
  if (!account) {
    return {
      ok: false,
      error: `No account found for "${username}". Switch to "Create Account" to register it.`,
    };
  }

  const expectedHash = hashCredential(username, password);
  if (account.passwordHash !== expectedHash) {
    return { ok: false, error: 'Incorrect password for this account.' };
  }

  setActiveSessionUser(account.username);
  return { ok: true, account };
}

export function loadUserVault(username: string): UserVaultData {
  const key = `${VAULT_PREFIX}${username.trim().toLowerCase()}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.transactions) && Array.isArray(parsed.categorySlots)) {
        return {
          transactions: sortTransactionsIncreasing(parsed.transactions),
          categorySlots:
            parsed.categorySlots.length === 16 ? parsed.categorySlots : DEFAULT_CATEGORY_SLOTS,
          activeMonthInput: typeof parsed.activeMonthInput === 'string' ? parsed.activeMonthInput : '',
        };
      }
    }
  } catch {
    // Fallback below
  }

  return {
    transactions: INITIAL_SEED_TRANSACTIONS,
    categorySlots: DEFAULT_CATEGORY_SLOTS,
    activeMonthInput: '',
  };
}

export function saveUserVault(username: string, vault: UserVaultData): void {
  const key = `${VAULT_PREFIX}${username.trim().toLowerCase()}`;
  try {
    localStorage.setItem(key, JSON.stringify(vault));
  } catch {
    // Ignore quota errors
  }
}
