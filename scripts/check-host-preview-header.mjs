import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [host, activityBanner, documentWeb, documentNative, previewWeb, previewNative, sidebarSlots] = await Promise.all([
  read("../src/content/ContentPreview.tsx"),
  read("../src/content/ContentActivityBanner.tsx"),
  read("../src/editor/SharedHtmlRenderer.web.tsx"),
  read("../src/editor/SharedHtmlRenderer.native.tsx"),
  read("../src/web-preview/WebPreview.web.tsx"),
  read("../src/web-preview/WebPreview.native.tsx"),
  read("../src/editor/SidebarPreviewSlots.tsx"),
]);

const requirements = [
  ["host renders the shared preview header", /style=\{styles\.header\}/, host],
  ["host header is exactly 48px", /header:\s*\{[\s\S]*?height:\s*48,/, host],
  ["host labels the active plugin generically", /plugin\?\.title/, host],
  ["host owns the files affordance", /accessibilityLabel="Open files"/, host],
  ["host owns the agent affordance", /accessibilityLabel="Open agent chat"/, host],
  ["host shows streaming state on the agent affordance", /isStreaming\s*\?\s*<View style=\{styles\.agentDot\}/, host],
  ["host keeps edge callbacks available to plugins", /onRequestFiles=\{props\.onRequestFiles\}[\s\S]*onRequestAgent=\{props\.onRequestAgent\}/, host],
  ["host activity appears outside the plugin renderer", /<ContentActivityBanner onPress=\{props\.onRequestAgent\} \/>[\s\S]*<View style=\{styles\.renderer\}>[\s\S]*<Renderer/, host],
  ["activity banner points back to the agent affordance", /<Svg[\s\S]*style=\{styles\.agentTail\}[\s\S]*<Polygon[\s\S]*<Polyline/, activityBanner],
  ["activity banner tail has an open one-pixel outline", /<Polyline[\s\S]*strokeWidth=\{1\}[\s\S]*strokeLinecap="round"[\s\S]*strokeLinejoin="round"/, activityBanner],
  ["activity banner tail aligns its 18px box with the 24px agent centre", /<Svg\s+width=\{18\}[\s\S]*agentTail:\s*\{[\s\S]*?right:\s*15,/, activityBanner],
  ["activity banner press feedback keeps the surface opaque", /<Pressable[\s\S]*styles\.contentPressed/, activityBanner],
  ["activity banner leads with a three-dot typing indicator", /function TypingIndicator\(\)[\s\S]*Animated\.loop[\s\S]*\[0, 1, 2\]\.map[\s\S]*<TypingIndicator \/>[\s\S]*<Text/, activityBanner],
  ["document web renderer preserves left edge swipe", /msg\.edge === "left"[\s\S]*onRequestFiles\?\.\(\)/, documentWeb],
  ["document web renderer preserves right edge swipe", /msg\.edge === "right"[\s\S]*onRequestAgent\?\.\(\)/, documentWeb],
  ["preview web renderer preserves left edge swipe", /message\.edge === "left"[\s\S]*onRequestFiles\?\.\(\)/, previewWeb],
  ["preview web renderer preserves right edge swipe", /message\.edge === "right"[\s\S]*onRequestAgent\?\.\(\)/, previewWeb],
  ["preview instance title lives in the sidebar slot", /styles\.label\}>\{first\.label\}/, sidebarSlots],
];

const forbidden = [
  ["web document renderer duplicates files chrome", /accessibilityLabel="Open files"/, documentWeb],
  ["web document renderer duplicates agent chrome", /accessibilityLabel="Open agent chat"/, documentWeb],
  ["native document renderer duplicates files chrome", /accessibilityLabel="Open files"/, documentNative],
  ["native document renderer duplicates agent chrome", /accessibilityLabel="Open agent chat"/, documentNative],
  ["web preview duplicates files chrome", /accessibilityLabel="Files"/, previewWeb],
  ["web preview duplicates agent chrome", /accessibilityLabel="Agent"/, previewWeb],
  ["native preview duplicates files chrome", /accessibilityLabel="Files"/, previewNative],
  ["native preview duplicates agent chrome", /accessibilityLabel="Agent"/, previewNative],
  ["web preview keeps a duplicate internal title toolbar", /style=\{styles\.toolbar\}/, previewWeb],
  ["native preview keeps a duplicate internal title toolbar", /style=\{styles\.toolbar\}/, previewNative],
  ["web preview keeps an internal instance picker", /<InstancePicker/, previewWeb],
  ["native preview keeps an internal instance picker", /<InstancePicker/, previewNative],
  ["host-to-plugin header slot contract survives", /slotBelowHeader/, `${host}\n${documentWeb}\n${documentNative}\n${previewWeb}\n${previewNative}`],
  ["activity banner no longer fades its surface on press", /activeOpacity=/, activityBanner],
  ["activity banner no longer uses layered CSS border triangles", /agentTailBorder|agentTailFill/, activityBanner],
  ["activity banner has no redundant chat icon", /<Icon\s+name="chat"/, activityBanner],
  ["activity banner has no spinning activity indicator", /<ActivityIndicator/, activityBanner],
];

const failures = [
  ...requirements.filter(([, pattern, source]) => !pattern.test(source)).map(([label]) => label),
  ...forbidden.filter(([, pattern, source]) => pattern.test(source)).map(([label]) => label),
];

if (failures.length) {
  console.error(`Host preview header contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Host preview header contract passed.");
