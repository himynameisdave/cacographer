import { describe, expect, test } from 'bun:test';
import { type DrawOp, type PlayerId, type VoteKind } from '../../src/lib/protocol';
import { buildGallery, countVotes, type StoredDrawing } from './gallery';

const OPS: DrawOp[] = [
	{ kind: 'stroke', id: 's1', points: [[0.1, 0.2]], color: '#000000', size: 4 }
];

function drawing(word: string, votes: Readonly<Record<PlayerId, VoteKind>> = {}): StoredDrawing {
	return {
		drawerId: 'p1',
		drawerName: 'Alice',
		word,
		ops: OPS,
		votes: new Map(Object.entries(votes))
	};
}

describe('countVotes', () => {
	test('empty map → zero counts', () => {
		expect(countVotes(new Map())).toEqual({ likes: 0, dislikes: 0 });
	});

	test('mixed votes tally per kind', () => {
		const votes = new Map<PlayerId, VoteKind>([
			['p2', 'like'],
			['p3', 'like'],
			['p4', 'dislike']
		]);
		expect(countVotes(votes)).toEqual({ likes: 2, dislikes: 1 });
	});
});

describe('buildGallery', () => {
	test('no drawings → both null', () => {
		expect(buildGallery([])).toEqual({ best: null, worst: null });
	});

	test('drawings without votes → both null', () => {
		expect(buildGallery([drawing('apple'), drawing('banana')])).toEqual({
			best: null,
			worst: null
		});
	});

	test('single liked drawing → best only, with snapshot fields intact', () => {
		const { best, worst } = buildGallery([drawing('apple', { p2: 'like' })]);
		expect(worst).toBeNull();
		expect(best).toEqual({
			drawerId: 'p1',
			drawerName: 'Alice',
			word: 'apple',
			ops: OPS,
			likes: 1,
			dislikes: 0
		});
	});

	test('single disliked drawing → worst only', () => {
		const { best, worst } = buildGallery([drawing('apple', { p2: 'dislike' })]);
		expect(best).toBeNull();
		expect(worst?.word).toBe('apple');
		expect(worst?.dislikes).toBe(1);
	});

	test('most likes wins best; most dislikes wins worst', () => {
		const g = buildGallery([
			drawing('apple', { p2: 'like' }),
			drawing('banana', { p2: 'like', p3: 'like' }),
			drawing('cherry', { p2: 'dislike', p3: 'dislike' }),
			drawing('grape', { p2: 'dislike' })
		]);
		expect(g.best?.word).toBe('banana');
		expect(g.best?.likes).toBe(2);
		expect(g.worst?.word).toBe('cherry');
		expect(g.worst?.dislikes).toBe(2);
	});

	test('like tie breaks toward fewer dislikes, then the earlier turn', () => {
		const fewerDislikes = buildGallery([
			drawing('apple', { p2: 'like', p3: 'dislike' }),
			drawing('banana', { p2: 'like' })
		]);
		expect(fewerDislikes.best?.word).toBe('banana');

		const earlier = buildGallery([
			drawing('apple', { p2: 'like' }),
			drawing('banana', { p3: 'like' })
		]);
		expect(earlier.best?.word).toBe('apple');
	});

	test('dislike tie breaks toward fewer likes, then the earlier turn', () => {
		const fewerLikes = buildGallery([
			drawing('apple', { p2: 'dislike', p3: 'like' }),
			drawing('banana', { p2: 'dislike' })
		]);
		expect(fewerLikes.worst?.word).toBe('banana');

		const earlier = buildGallery([
			drawing('apple', { p2: 'dislike' }),
			drawing('banana', { p3: 'dislike' })
		]);
		expect(earlier.worst?.word).toBe('apple');
	});

	test('the best drawing is never also worst — runner-up takes worst', () => {
		const g = buildGallery([
			drawing('apple', { p2: 'like', p3: 'like', p4: 'dislike', p5: 'dislike' }),
			drawing('banana', { p2: 'dislike' })
		]);
		expect(g.best?.word).toBe('apple');
		expect(g.worst?.word).toBe('banana');
	});

	test('a polarizing sole drawing shows only as best', () => {
		const g = buildGallery([drawing('apple', { p2: 'like', p3: 'dislike' })]);
		expect(g.best?.word).toBe('apple');
		expect(g.worst).toBeNull();
	});
});
