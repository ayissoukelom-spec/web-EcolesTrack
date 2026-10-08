import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppLayout from './AppLayout.tsx';
import type { UserRole } from '../types.ts';

vi.mock('./SimulatorHeader.tsx', () => ({ default: () => null }));

const renderLayout = (role: UserRole, onTabChange = vi.fn()) => render(
  <AppLayout
    currentRole={role}
    schoolsList={[]}
    parentsList={[]}
    classesList={[]}
    teachersList={[]}
    studentsList={[]}
    yearsList={[]}
    notificationsList={[]}
    activeTab="tableau-de-bord"
    isSyncing={false}
    errorMsg={null}
    onRoleChange={() => undefined}
    onLogout={() => undefined}
    onRefreshData={async () => undefined}
    onManageAccounts={() => undefined}
    onTabChange={onTabChange}
    onClearError={() => undefined}
  >
    <div>Contenu</div>
  </AppLayout>,
);

afterEach(() => cleanup());

describe('accounting sidebar navigation', () => {
  it.each(['school_admin', 'super_admin'] as const)('shows the accounting entry for %s at desktop and mobile widths', (role) => {
    const onTabChange = vi.fn();
    renderLayout(role, onTabChange);

    const sidebar = document.getElementById('main-sidebar');
    const navigation = screen.getByRole('navigation', { name: 'Navigation principale' });
    const accountingLink = screen.getByRole('button', { name: 'Comptabilité' });
    expect(sidebar?.contains(accountingLink)).toBe(true);
    expect(navigation.contains(accountingLink)).toBe(true);
    expect(sidebar?.className).toContain('w-full');
    expect(sidebar?.className).toContain('lg:w-64');

    fireEvent.click(accountingLink);
    expect(onTabChange).toHaveBeenCalledWith('accounting');
  });

  it.each(['teacher', 'parent', 'surveillant'] as const)('does not show the accounting entry for %s', (role) => {
    renderLayout(role);
    expect(screen.queryByRole('button', { name: 'Comptabilité' })).toBeNull();
  });
});
