import { Card, Notice } from '../components/Primitives.tsx';

/**
 * Placeholder. The viewer flow is the next slice; the sharer half had to work
 * first, because it is the half that did not exist at all.
 */
export function Join({ token }: { token?: string }) {
  return (
    <Card className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">Join a session</h1>
      <Notice>
        The viewer is being rebuilt on the new session flow and lands in the next slice.
        {token !== undefined && ' Your link was recognised and will be used automatically.'}
      </Notice>
    </Card>
  );
}
