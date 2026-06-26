#!/usr/bin/env python3
import re

# Read the file
with open('src/components/AdminView.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Change the label dynamically: École {newUserForm.role === 'school_admin' ? '*' : '(optionnel)'}
# Find the label in the create user form (the first one with newUserForm)
# Pattern: <label>École (optionnel)</label> before value={newUserForm.schoolId}

# Find all occurrences and replace the first one (in the create form)
lines = content.split('\n')
in_create_form = False
found_role_select = False
label_replaced = False

for i, line in enumerate(lines):
    # Detect start of create form
    if 'showCreateUserForm && activeTab === \'accounts\'' in line:
        in_create_form = True
    
    # If we found the start and see role select, mark it
    if in_create_form and 'value={newUserForm.role}' in line:
        found_role_select = True
    
    # If we found the role select and now see the school label, replace it
    if in_create_form and found_role_select and not label_replaced and 'École (optionnel)' in line:
        lines[i] = line.replace(
            'École (optionnel)',
            "École {newUserForm.role === 'school_admin' ? '*' : '(optionnel)'}"
        )
        label_replaced = True
        break

# Rejoin lines
content = '\n'.join(lines)

# 2. Add validation: if school_admin, schoolId is required
# Find the password match check in create form and add validation after it
pattern = r"(if \(newUserPassword !== newUserPasswordConfirm\) \{\s*setCreateUserError\('Les mots de passe ne correspondent pas'\);\s*return;\s*\}\s*)(if \(onCreateUser\))"

replacement = r"\1if (newUserForm.role === 'school_admin' && !newUserForm.schoolId) {\n                    setCreateUserError('Une école est requise pour un Admin École');\n                    return;\n                  }\n                  \2"

content = re.sub(pattern, replacement, content, flags=re.DOTALL)

# Write back
with open('src/components/AdminView.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("✓ Fixed school admin validation and label")
