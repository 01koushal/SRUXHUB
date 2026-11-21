import { describe, expect, it } from 'vitest';
import { buildCommentTree, commentDescendantIds, countTopLevelComments } from './commentTree';
import type { Comment } from './service';

function comment(id: string, parent_comment_id: string | null, post_id = 'post-a'): Comment {
  return { id, post_id, parent_comment_id, content: id, created_at: id, author_id: 'author', profiles: null };
}

describe('comment threading', () => {
  it('builds multiple nested reply levels beneath their parent comments', () => {
    const tree = buildCommentTree([
      comment('root', null), comment('reply', 'root'), comment('deep-reply', 'reply'), comment('fourth-level', 'deep-reply'),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].children[0].children[0].id).toBe('fourth-level');
  });

  it('does not attach a cross-post parent as a child', () => {
    const tree = buildCommentTree([comment('root', null), comment('cross-post', 'root', 'post-b')]);
    expect(tree.map(row => row.id)).toEqual(['root', 'cross-post']);
    expect(tree[0].children).toHaveLength(0);
  });

  it('collects all descendants for cascade deletion and counts top-level comments only', () => {
    const comments = [comment('root', null), comment('reply', 'root'), comment('nested', 'reply'), comment('other-root', null)];
    expect(commentDescendantIds('root', comments)).toEqual(['reply', 'nested']);
    expect(countTopLevelComments(comments)).toBe(2);
  });
});
