import inquirer from 'inquirer';

import { loadConfig, saveConfig } from './config';

import type { Logger } from './logger';

export function validatePAT(token: string): boolean {
  return typeof token === 'string' && (token.startsWith('tz_pat_') || token.startsWith('tz_'));
}

export interface LoginOptions {
  token?: string;
  username?: string;
  logger?: Logger;
}

export async function login(opts: LoginOptions = {}): Promise<void> {
  let token = opts.token;
  if (!token) {
    // Manual paste prompt
    const answer = await inquirer.prompt<{ token: string }>([
      {
        type: 'password',
        name: 'token',
        message: 'Paste your Terrazul Personal Access Token (tz_...)',
        mask: '*',
      },
    ]);
    token = answer.token;
  }

  if (!token || !validatePAT(token)) {
    throw new Error('Invalid token: expected prefix tz_');
  }

  const cfg = await loadConfig();
  const activeEnvName = cfg.environment;
  const activeEnv = cfg.environments[activeEnvName] ?? { registry: cfg.registry };
  cfg.environments[activeEnvName] = {
    ...activeEnv,
    token,
    username: opts.username ?? activeEnv.username,
  };
  cfg.token = token;
  if (opts.username) cfg.username = opts.username;
  await saveConfig(cfg);
  opts.logger?.info(`Logged in successfully for ${activeEnvName}. Token saved.`);
}

export async function logout(opts: { logger?: Logger } = {}): Promise<void> {
  const cfg = await loadConfig();
  const activeEnvName = cfg.environment;
  if (cfg.environments[activeEnvName]) {
    delete cfg.environments[activeEnvName].token;
    delete cfg.environments[activeEnvName].tokenExpiry;
    delete cfg.environments[activeEnvName].username;
  }
  delete cfg.token;
  delete cfg.username;
  await saveConfig(cfg);
  opts.logger?.info(`Logged out from ${activeEnvName}. Token cleared.`);
}
