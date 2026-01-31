import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAccount } from './accounts';
import { repository } from '../data';
import type { Account, Settings } from '../schemas';
import { defaultSettings } from '../schemas';

vi.mock('../data', () => ({
  repository: {
    saveAccount: vi.fn(),
    getAccounts: vi.fn(),
    getSettings: vi.fn(),
    getAccount: vi.fn(),
    deleteAccount: vi.fn(),
  },
}));

const mockRepository = vi.mocked(repository);

describe('createAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('auto-create employer SG', () => {
    const defaultTestSettings: Settings = {
      ...defaultSettings,
      super: {
        ...defaultSettings.super,
        autoCreateEmployerSg: true,
        employerSgRate: 0.115,
      },
    };

    const superAccount: Account = {
      id: '11111111-1111-1111-a111-111111111111',
      name: 'Super Account',
      type: 'asset',
      assetSubType: 'superannuation',
      owner: '22222222-2222-2222-a222-222222222222',
      initialValue: 100000,
      growthProfile: { type: 'fixed', rate: 0.06 },
      category: 'standard',
      includeInNetWorth: true,
    };

    it('auto-creates SG account when salary income created with 1 super account', async () => {
      mockRepository.getSettings.mockResolvedValue(defaultTestSettings);
      mockRepository.getAccounts.mockResolvedValue([superAccount]);
      mockRepository.saveAccount.mockResolvedValue(undefined);

      const salaryAccount = await createAccount({
        name: 'Salary',
        type: 'income',
        incomeSubType: 'salary',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        owner: '22222222-2222-2222-a222-222222222222',
      });

      expect(salaryAccount.name).toBe('Salary');
      expect(salaryAccount.incomeSubType).toBe('salary');

      // Should have saved 2 accounts: salary + SG
      expect(mockRepository.saveAccount).toHaveBeenCalledTimes(2);

      // Check the SG account was created correctly
      const sgAccountCall = mockRepository.saveAccount.mock.calls[1][0];
      expect(sgAccountCall.name).toBe('Salary - Employer SG');
      expect(sgAccountCall.type).toBe('income');
      expect(sgAccountCall.incomeSubType).toBe('other');
      expect(sgAccountCall.basedOnAccountId).toBe(salaryAccount.id);
      expect(sgAccountCall.basedOnPercentage).toBe(0.115);
      expect(sgAccountCall.owner).toBe('22222222-2222-2222-a222-222222222222');
      expect(sgAccountCall.superContributionConfig).toEqual({
        targetSuperAccountId: '11111111-1111-1111-a111-111111111111',
        contributionType: 'concessional',
        source: 'employerSG',
        reducesAssessableIncome: false,
      });
    });

    it('creates SG account without super config when 0 super accounts exist', async () => {
      mockRepository.getSettings.mockResolvedValue(defaultTestSettings);
      mockRepository.getAccounts.mockResolvedValue([]); // No super accounts
      mockRepository.saveAccount.mockResolvedValue(undefined);

      await createAccount({
        name: 'Salary',
        type: 'income',
        incomeSubType: 'salary',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        owner: '22222222-2222-2222-a222-222222222222',
      });

      expect(mockRepository.saveAccount).toHaveBeenCalledTimes(2);

      const sgAccountCall = mockRepository.saveAccount.mock.calls[1][0];
      expect(sgAccountCall.name).toBe('Salary - Employer SG');
      expect(sgAccountCall.superContributionConfig).toBeUndefined();
    });

    it('creates SG account without super config when 2+ super accounts exist', async () => {
      const secondSuperAccount: Account = {
        ...superAccount,
        id: '33333333-3333-3333-a333-333333333333',
        name: 'Super Account 2',
      };

      mockRepository.getSettings.mockResolvedValue(defaultTestSettings);
      mockRepository.getAccounts.mockResolvedValue([superAccount, secondSuperAccount]);
      mockRepository.saveAccount.mockResolvedValue(undefined);

      await createAccount({
        name: 'Salary',
        type: 'income',
        incomeSubType: 'salary',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        owner: '22222222-2222-2222-a222-222222222222',
      });

      expect(mockRepository.saveAccount).toHaveBeenCalledTimes(2);

      const sgAccountCall = mockRepository.saveAccount.mock.calls[1][0];
      expect(sgAccountCall.name).toBe('Salary - Employer SG');
      expect(sgAccountCall.superContributionConfig).toBeUndefined();
    });

    it('does not create SG account when autoCreateEmployerSg is disabled', async () => {
      const settingsWithAutoCreateDisabled: Settings = {
        ...defaultTestSettings,
        super: {
          ...defaultTestSettings.super,
          autoCreateEmployerSg: false,
        },
      };

      mockRepository.getSettings.mockResolvedValue(settingsWithAutoCreateDisabled);
      mockRepository.saveAccount.mockResolvedValue(undefined);

      await createAccount({
        name: 'Salary',
        type: 'income',
        incomeSubType: 'salary',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        owner: '22222222-2222-2222-a222-222222222222',
      });

      // Should only save the salary account, not the SG account
      expect(mockRepository.saveAccount).toHaveBeenCalledTimes(1);
    });

    it('does not create SG account for non-salary income', async () => {
      mockRepository.getSettings.mockResolvedValue(defaultTestSettings);
      mockRepository.saveAccount.mockResolvedValue(undefined);

      await createAccount({
        name: 'Rental Income',
        type: 'income',
        incomeSubType: 'investment',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0.02 },
        owner: '22222222-2222-2222-a222-222222222222',
      });

      // Should only save the rental income account
      expect(mockRepository.saveAccount).toHaveBeenCalledTimes(1);
    });

    it('uses custom SG rate from settings', async () => {
      const customSettings: Settings = {
        ...defaultTestSettings,
        super: {
          ...defaultTestSettings.super,
          employerSgRate: 0.12, // 12%
        },
      };

      mockRepository.getSettings.mockResolvedValue(customSettings);
      mockRepository.getAccounts.mockResolvedValue([superAccount]);
      mockRepository.saveAccount.mockResolvedValue(undefined);

      await createAccount({
        name: 'Salary',
        type: 'income',
        incomeSubType: 'salary',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        owner: '22222222-2222-2222-a222-222222222222',
      });

      const sgAccountCall = mockRepository.saveAccount.mock.calls[1][0];
      expect(sgAccountCall.basedOnPercentage).toBe(0.12);
    });

    it('only matches super accounts owned by the same person', async () => {
      const otherPersonSuperAccount: Account = {
        ...superAccount,
        owner: '44444444-4444-4444-a444-444444444444', // Different owner
      };

      mockRepository.getSettings.mockResolvedValue(defaultTestSettings);
      mockRepository.getAccounts.mockResolvedValue([otherPersonSuperAccount]);
      mockRepository.saveAccount.mockResolvedValue(undefined);

      await createAccount({
        name: 'Salary',
        type: 'income',
        incomeSubType: 'salary',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        owner: '22222222-2222-2222-a222-222222222222',
      });

      const sgAccountCall = mockRepository.saveAccount.mock.calls[1][0];
      expect(sgAccountCall.superContributionConfig).toBeUndefined();
    });
  });
});
