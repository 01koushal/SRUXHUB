import {describe,expect,it} from 'vitest';
import {validateDisplayName,validateUsername} from './validation';
describe('profile onboarding validation',()=>{
 it('accepts usernames with 3 to 24 letters, digits or underscores',()=>{expect(validateUsername('sru_student7')).toBe(true);expect(validateUsername('abc')).toBe(true);expect(validateUsername('a'.repeat(24))).toBe(true)});
 it('rejects short, long, spaced or punctuated usernames',()=>{expect(validateUsername('ab')).toBe(false);expect(validateUsername('a'.repeat(25))).toBe(false);expect(validateUsername('has space')).toBe(false);expect(validateUsername('bad-name')).toBe(false)});
 it('bounds the display name',()=>{expect(validateDisplayName('Koushal')).toBe(true);expect(validateDisplayName('  ')).toBe(false);expect(validateDisplayName('n'.repeat(61))).toBe(false)});
});
