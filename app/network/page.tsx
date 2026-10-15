import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'WardLab | Network Workbench',
  description: 'DNS, HTTPS, certificate and local network inspection tools.',
};

export default function NetworkPage() {
  return <iframe title="WardLab Network Workbench" src="/network-tools/index.html" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0, zIndex: 1000, background: '#0b1117' }} />;
}
