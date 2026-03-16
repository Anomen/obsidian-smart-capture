import { execSync } from "child_process";
import { environment } from "@raycast/api";
import fs from "fs";
import path from "path";

const SWIFT_SOURCE = `
import Vision
import AppKit

guard CommandLine.arguments.count > 1 else { exit(0) }
let imgPath = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: imgPath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(0) }
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
try handler.perform([request])
let text = request.results?.compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ") ?? ""
print(text)
`;

function getCompiledBinaryPath(): string {
  return path.join(environment.supportPath, "ocr-tool");
}

function ensureBinary(): string {
  const binaryPath = getCompiledBinaryPath();
  if (fs.existsSync(binaryPath)) return binaryPath;

  const supportDir = environment.supportPath;
  if (!fs.existsSync(supportDir)) {
    fs.mkdirSync(supportDir, { recursive: true });
  }

  const sourcePath = path.join(supportDir, "ocr-tool.swift");
  fs.writeFileSync(sourcePath, SWIFT_SOURCE, "utf8");
  execSync(`swiftc -O -o "${binaryPath}" "${sourcePath}"`, { timeout: 30000 });
  fs.unlinkSync(sourcePath);

  return binaryPath;
}

export async function extractTextFromImage(imagePath: string): Promise<string> {
  if (!fs.existsSync(imagePath)) return "";

  try {
    const binary = ensureBinary();
    const result = execSync(`"${binary}" "${imagePath}"`, { timeout: 10000, encoding: "utf8" });
    return result.trim();
  } catch {
    return "";
  }
}

export async function extractTextFromImages(imagePaths: string[]): Promise<string> {
  const results = await Promise.all(imagePaths.map(extractTextFromImage));
  return results.filter(Boolean).join(" ");
}
