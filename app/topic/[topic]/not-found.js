import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
      <h1 className="text-4xl font-bold mb-4">404 - Topic Not Found</h1>
      <Link href="/">
        <div className="text-blue-600 hover:underline text-lg font-medium">
          ← Back to topic list
        </div>
      </Link>
    </div>
  );
}
