import { identity, json, failure, body } from '@/lib/server';
import { getCategories } from '@/lib/categories-server';
import { backfillLegacyReviews, loadReviewRows } from '@/lib/reviews-server';
import { buildReviewMemory } from '@/lib/review-memory';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await identity();
    const [reviews, categories] = await Promise.all([
      loadReviewRows(user.userId),
      getCategories(user.userId),
    ]);
    return json({
      clusters: buildReviewMemory(reviews, categories),
      reviews,
      totalReviews: reviews.length,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const value = await body(request);
    const limit = Number.isInteger(value.limit) ? value.limit : 50;
    return json(await backfillLegacyReviews(user.userId, limit));
  } catch (error) {
    return failure(error);
  }
}
