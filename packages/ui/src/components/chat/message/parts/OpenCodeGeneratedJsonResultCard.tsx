import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useRepositoryReferenceProvider } from '@/components/references/referenceSources';
import { GeneratedJsonResultPresentation } from './GeneratedJsonResultCard';
import type { GeneratedResult } from './generatedJsonResult';

export default function OpenCodeGeneratedJsonResultCard({ result }: { result: GeneratedResult }) {
  const repositoryProvider = useRepositoryReferenceProvider(useEffectiveDirectory() ?? null);
  return <GeneratedJsonResultPresentation result={result} repositoryProvider={repositoryProvider} />;
}
