import { authorize, type AccessEnv } from '../../src/server/access'

export const onRequest: PagesFunction<AccessEnv> = async ({ request, env, next }) => {
  return (await authorize(request, env)) ?? next()
}
