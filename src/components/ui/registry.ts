/**
 * UI Plugin Registry.
 *
 * UI components are decoupled from account/event types via this registry.
 * New account types can have their renderers and editors registered here,
 * without modifying SpreadsheetView, AccountForm, or other core components.
 */

import type { Account } from '../../schemas';
import type { AccountId } from '../../domain/types';
import type { ComponentType } from 'react';

// ============================================
// UI Plugin interfaces
// ============================================

export interface AccountRendererProps {
  account: Account;
  accountId: AccountId;
  yearValues: Record<string, number>;
  onAccountClick: (accountId: string) => void;
}

export interface AccountEditorProps {
  account: Account | null;
  onSave: (data: Omit<Account, 'id'>) => void;
  onDelete?: (accountId: string) => void;
  accounts: Account[];
}

export interface AccountRenderer {
  readonly accountType: string;
  readonly component: ComponentType<AccountRendererProps>;
}

export interface AccountEditor {
  readonly accountType: string;
  readonly component: ComponentType<AccountEditorProps>;
}

export interface FeatureCapability {
  readonly id: string;
  readonly enabled: boolean;
  readonly dependsOn?: string[];
  readonly description?: string;
}

// ============================================
// UIPluginRegistry
// ============================================

export class UIPluginRegistry {
  private accountRenderers = new Map<string, AccountRenderer>();
  private accountEditors = new Map<string, AccountEditor>();
  private capabilities = new Map<string, FeatureCapability>();

  registerAccountRenderer(renderer: AccountRenderer): void {
    this.accountRenderers.set(renderer.accountType, renderer);
  }

  registerAccountEditor(editor: AccountEditor): void {
    this.accountEditors.set(editor.accountType, editor);
  }

  registerCapability(capability: FeatureCapability): void {
    this.capabilities.set(capability.id, capability);
  }

  getAccountRenderer(accountType: string): AccountRenderer | undefined {
    return this.accountRenderers.get(accountType);
  }

  getAccountEditor(accountType: string): AccountEditor | undefined {
    return this.accountEditors.get(accountType);
  }

  getCapability(id: string): FeatureCapability | undefined {
    return this.capabilities.get(id);
  }

  isCapabilityEnabled(id: string): boolean {
    const cap = this.capabilities.get(id);
    return cap?.enabled ?? false;
  }

  getAllRenderers(): AccountRenderer[] {
    return [...this.accountRenderers.values()];
  }

  getAllEditors(): AccountEditor[] {
    return [...this.accountEditors.values()];
  }
}

export const defaultUIPluginRegistry = new UIPluginRegistry();
