import DemoSandbox from "@/demo/DemoSandbox";

// Public learning mode: no authentication flow and no API/database dependency.
// The demo uses synthetic data persisted only in the current browser's localStorage.
export default function App() {
  return <DemoSandbox />;
}
