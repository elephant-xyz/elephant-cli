import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { DownloadResult } from "../types";

export class IPFSService {
  private gateway: string;

  constructor(gatewayUrl: string) {
    this.gateway = gatewayUrl.endsWith("/") ? gatewayUrl : gatewayUrl + "/";
  }

  async downloadFile(cid: string, outputPath: string): Promise<DownloadResult> {
    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const url = `${this.gateway}${cid}`;
      const response = await axios.get(url, {
        responseType: "stream",
        timeout: 30000 // 30 second timeout
      });

      const writer = fs.createWriteStream(outputPath);
      response.data.pipe(writer);

      await new Promise<void>((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      return {
        cid,
        success: true,
        path: outputPath
      };
    } catch (error) {
      return {
        cid,
        success: false,
        error: error as Error
      };
    }
  }
}