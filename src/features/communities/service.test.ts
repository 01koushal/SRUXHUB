import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: { from: mocks.from } }));

import { getCommunityBySlug } from './service';

describe('getCommunityBySlug', () => {
  beforeEach(() => {
    mocks.maybeSingle.mockReset();
    mocks.eq.mockReset();
    mocks.select.mockReset();
    mocks.from.mockReset();
    const query = {
      select: mocks.select,
      eq: mocks.eq,
      maybeSingle: mocks.maybeSingle,
    };
    mocks.from.mockReturnValue(query);
    mocks.select.mockReturnValue(query);
    mocks.eq.mockReturnValue(query);
  });

  it('resolves a community directly by slug without relying on a paged community list', async () => {
    const community = { id: 'dsa-id', slug: 'dsa', name: 'DSA' };
    mocks.maybeSingle.mockResolvedValue({ data: community, error: null });

    await expect(getCommunityBySlug('dsa')).resolves.toEqual(community);
    expect(mocks.from).toHaveBeenCalledWith('communities');
    expect(mocks.eq).toHaveBeenCalledWith('slug', 'dsa');
    expect(mocks.maybeSingle).toHaveBeenCalledOnce();
  });

  it('returns null for a missing slug and surfaces query errors separately', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(getCommunityBySlug('missing')).resolves.toBeNull();

    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error('database unavailable') });
    await expect(getCommunityBySlug('dsa')).rejects.toThrow('database unavailable');
  });
});
