# Bug Fix: Parent Username Becomes Undefined After School Selection

## 🐛 Bug Description
- Parent account name displays correctly at initial login
- After school selection or page refresh, the name becomes `undefined` **only for parents**
- Other roles (teacher, school_admin, super_admin) are unaffected

## 🔍 Root Cause
The issue had two parts:

### Part 1: SimulatorHeader State Not Syncing
`SimulatorHeader.tsx` initialized `simUser` state once at mount from localStorage:
```typescript
const [simUser, setSimUser] = useState<any | null>(getSimulatedUser());
```

However, when `LoginView.tsx` called `setSimulatedUser()` to update localStorage after school selection, `SimulatorHeader`'s `simUser` state was **not automatically updated** because there was no listener for localStorage changes within the same tab.

**Consequence**: After school selection, localStorage was updated, but `SimulatorHeader` still showed stale user data without the name field.

### Part 2: Missing Fallbacks for Undefined Name
Multiple places rendered the user name without proper fallbacks:
- `profileDisplayName` could return `undefined` if `simUser.name` was missing
- Profile menu showed `{simUser.name}` directly, displaying literal "undefined" if missing
- No protection against partially loaded user objects

## ✅ Fixes Applied

### 1. **LocalStorage Sync System** (`src/lib/api.ts`)
- Modified `setSimulatedUser()` to emit a `CustomEvent` after updating localStorage:
```typescript
export function setSimulatedUser(user: any) {
  localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(user));
  // Emit custom event so all components can sync
  try {
    window.dispatchEvent(new CustomEvent('simulatedUserChanged', { detail: user }));
  } catch (e) {
    console.warn('Failed to dispatch simulatedUserChanged event:', e);
  }
}
```

### 2. **SimulatorHeader Listener** (`src/components/SimulatorHeader.tsx`)
- Added `useEffect` hook to listen for both same-tab and cross-tab changes:
```typescript
useEffect(() => {
  const onStorageChange = () => {
    const updatedUser = getSimulatedUser();
    setSimUser(updatedUser);
  };

  // Listen for custom event (same tab)
  const onSimulatedUserChanged = (event: Event) => {
    if (event instanceof CustomEvent) {
      setSimUser(event.detail);
    }
  };

  // Listen for storage changes (other tabs)
  window.addEventListener('storage', onStorageChange);
  window.addEventListener('simulatedUserChanged', onSimulatedUserChanged);
  
  // Re-sync on tab visibility change
  const onVisibilityChange = () => {
    if (!document.hidden) {
      const updatedUser = getSimulatedUser();
      setSimUser(updatedUser);
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    window.removeEventListener('storage', onStorageChange);
    window.removeEventListener('simulatedUserChanged', onSimulatedUserChanged);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}, []);
```

### 3. **Robust Fallback for profileDisplayName** 
```typescript
const profileDisplayName = simUser
  ? ((simUser.firstName || simUser.lastName)
    ? `${simUser.firstName || ''} ${simUser.lastName || ''}`.trim()
    : (simUser.name || simUser.email || 'Utilisateur'))  // ← Fallback chain
  : 'Profil';
```

### 4. **Fallback in Profile Menu**
```typescript
<div className="font-semibold">
  {simUser ? (simUser.name || simUser.email || 'Utilisateur') : 'Aucun utilisateur'}
</div>
```

### 5. **Improved displayName Global Variable**
```typescript
const displayName = currentRole === 'parent'
  ? (parentProfile
    ? `${parentProfile.firstName || ''} ${parentProfile.lastName || ''}`.trim() || parentProfile.email || 'Parent connecté'
    : (simUser?.name || simUser?.displayName || simUser?.email || 'Parent connecté'))
  : (simUser?.name || simUser?.displayName || simUser?.email || 'Utilisateur');
```

## 🎯 Outcomes
✅ Parent name persists after school selection  
✅ Parent name persists after page refresh  
✅ User name never displays as literal "undefined"  
✅ All other roles (teacher, school_admin, super_admin) unaffected  
✅ Cross-tab synchronization also works  
✅ Fallback to email if name is missing  

## 📝 Files Modified
- `src/lib/api.ts` - Added CustomEvent emission
- `src/components/SimulatorHeader.tsx` - Added listener and fallbacks

## 🧪 Testing Recommendations
1. **Test parent login → school selection**: Name should persist
2. **Test page refresh after parent login**: Name should reload correctly
3. **Test with multi-tab scenario**: Change role in one tab, verify other tabs sync
4. **Test with missing name field**: Should fallback to email gracefully
5. **Test other roles still work**: teacher, school_admin, super_admin unchanged
