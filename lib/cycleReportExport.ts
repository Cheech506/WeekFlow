import { Platform } from 'react-native';

function createReportFileName(cycleLabel: string) {
  const safeLabel = cycleLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'cycle';

  return `weekflow-${safeLabel}-report.md`;
}

function downloadReportOnWeb(markdown: string, fileName: string) {
  const blob = new Blob([markdown], {
    type: 'text/markdown;charset=utf-8',
  });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = objectUrl;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

async function shareReportOnNative(markdown: string, fileName: string) {
  const [{ File, Paths }, Sharing] = await Promise.all([
    import('expo-file-system'),
    import('expo-sharing'),
  ]);
  const reportFile = new File(Paths.cache, fileName);

  reportFile.create({ overwrite: true });
  reportFile.write(markdown);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error(
      'File sharing is not available on this device. Export the report from WeekFlow on the web instead.'
    );
  }

  await Sharing.shareAsync(reportFile.uri, {
    dialogTitle: 'Export WeekFlow Cycle Report',
    mimeType: 'text/markdown',
    UTI: 'net.daringfireball.markdown',
  });
}

export async function exportCycleReport(
  cycleLabel: string,
  markdown: string
) {
  const fileName = createReportFileName(cycleLabel);

  if (Platform.OS === 'web') {
    downloadReportOnWeb(markdown, fileName);
  } else {
    await shareReportOnNative(markdown, fileName);
  }

  return fileName;
}
