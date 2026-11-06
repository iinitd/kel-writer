import { isWeb } from "../constants/platform";
import { WebPreview as WebPreviewWeb } from "./WebPreview.web";
import { WebPreview as WebPreviewNative } from "./WebPreview.native";
export interface WebPreviewProps { onRequestFiles?:()=>void; onRequestAgent?:()=>void; hideInlineCommentBar?:boolean; active?:boolean }
export function WebPreview(props:WebPreviewProps){return isWeb?<WebPreviewWeb {...props}/>:<WebPreviewNative {...props}/>;}
