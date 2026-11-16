import {cloudOriginCandidates} from '../../shared/domains.mjs';

export async function withCloudOrigin(primary, operation) {
  let failure;
  for (const origin of cloudOriginCandidates(primary)) {
    try { return {value: await operation(origin), origin}; }
    catch (error) { failure = error; }
  }
  throw failure;
}
