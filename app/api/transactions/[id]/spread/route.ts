import { getDb } from '@/db';
import { body, failure, identity, json, AppError, textValue } from '@/lib/server';
import { saveSpread } from '@/lib/expense-spreading-server';

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await identity(request);
    const value = await body(request);
    const { id } = await context.params;
    if (id !== textValue(value.id ?? id, 120)) throw new AppError('Invalid transaction.');
    const operationId = textValue(value.operationId, 120);
    if (!/^[A-Za-z0-9:_-]+$/.test(operationId)) throw new AppError('Invalid spread operation.');
    if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) throw new AppError('Refresh this transaction before saving the spread.', 409, 'stale_spread');
    const schedule = value.schedule;
    if (schedule !== null && (typeof schedule !== 'object' || typeof schedule.startMonth !== 'string' || !Number.isSafeInteger(schedule.monthCount))) throw new AppError('Choose a valid spread schedule.');
    return json(await saveSpread(getDb(), user.userId, { id, operationId, expectedRevision: value.expectedRevision, schedule }));
  } catch (error) { return failure(error); }
}
