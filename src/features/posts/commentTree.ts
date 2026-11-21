import type { Comment } from './service';

export type CommentNodeData = Comment & { children: CommentNodeData[] };

export function buildCommentTree(comments: Comment[]): CommentNodeData[] {
  const nodes = new Map<string, CommentNodeData>();
  for (const comment of comments) nodes.set(comment.id, { ...comment, children: [] });
  const roots: CommentNodeData[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_comment_id ? nodes.get(node.parent_comment_id) : undefined;
    if (parent && parent.post_id === node.post_id) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function commentDescendantIds(commentId: string, comments: Comment[]): string[] {
  const descendants: string[] = [];
  const children = new Map<string, string[]>();
  for (const comment of comments) if (comment.parent_comment_id) {
    const siblings = children.get(comment.parent_comment_id) ?? [];
    siblings.push(comment.id);
    children.set(comment.parent_comment_id, siblings);
  }
  const visited = new Set([commentId]);
  const queue = [...(children.get(commentId) ?? [])];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    descendants.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return descendants;
}

export function countTopLevelComments(comments: Comment[]) {
  return comments.filter(comment => !comment.parent_comment_id).length;
}
