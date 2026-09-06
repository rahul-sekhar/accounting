import { identity, json, failure, body, AppError, textValue } from '@/lib/server';
import { saveReview } from '@/lib/reviews-server';

const actions = ['correct', 'confirm', 'memory_enable', 'memory_disable'] as const;

export async function PATCH(request: Request) {
  try {
    const user = await identity(request);
    const value = await body(request);
    const action = actions.find((candidate) => candidate === value.action);
    if (!action) throw new AppError('Choose a valid review action.');
    if (typeof value.learn !== 'boolean' && action !== 'memory_enable' && action !== 'memory_disable')
      value.learn = true;
    if (typeof value.learn !== 'boolean') value.learn = action === 'memory_enable';
    if (!Number.isInteger(value.expectedRevision) || value.expectedRevision < 0)
      throw new AppError('Refresh this transaction before reviewing it.', 409);
    const operationId = textValue(value.operationId, 120);
    if (!/^[A-Za-z0-9:_-]+$/.test(operationId))
      throw new AppError('Invalid review operation.');
    return json(
      await saveReview(user.userId, {
        id: textValue(value.id),
        category: textValue(value.category),
        action,
        learn: value.learn,
        operationId,
        expectedRevision: value.expectedRevision,
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
