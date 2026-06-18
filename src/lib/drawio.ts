import type { Component, ComponentType } from "./types"

const typeStyles: Record<ComponentType, string> = {
  component:       "rounded=1;fillColor=#eef2ff;strokeColor=#6366f1;fontStyle=1;fontSize=11;",
  service:         "rounded=1;fillColor=#cffafe;strokeColor=#0891b2;fontStyle=1;fontSize=11;",
  microservice:    "rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;fontSize=11;",
  frontend:        "rounded=1;fillColor=#d5e8d4;strokeColor=#82b366;fontStyle=1;fontSize=11;",
  database:        "shape=cylinder3;fillColor=#fff2cc;strokeColor=#d6b656;fontStyle=1;fontSize=11;",
  table:           "rounded=0;fillColor=#fef3c7;strokeColor=#d97706;fontStyle=1;fontSize=11;",
  schema:          "rounded=0;fillColor=#fce7f3;strokeColor=#db2777;fontStyle=1;fontSize=11;dashed=1;",
  queue:           "rounded=1;fillColor=#f8cecc;strokeColor=#b85450;fontStyle=1;fontSize=11;",
  gateway:         "rhombus;fillColor=#e1d5e7;strokeColor=#9673a6;fontStyle=1;fontSize=11;",
  external:        "rounded=1;fillColor=#f5f5f5;strokeColor=#666666;fontStyle=1;fontSize=11;dashed=1;",
  platform:        "rounded=1;fillColor=#ffe6cc;strokeColor=#d79b00;fontStyle=1;fontSize=11;",
  library:         "rounded=1;fillColor=#f0f0f0;strokeColor=#999999;fontStyle=1;fontSize=11;",
  "data-pipeline": "rounded=1;fillColor=#d4e8f7;strokeColor=#3a7ca5;fontStyle=1;fontSize=11;",
  storage:         "shape=cylinder3;fillColor=#e8dff0;strokeColor=#7b5ea7;fontStyle=1;fontSize=11;",
  "batch-job":     "rounded=1;fillColor=#fce4d6;strokeColor=#c55a11;fontStyle=1;fontSize=11;dashed=1;",
  cache:           "rounded=1;fillColor=#d6f5d6;strokeColor=#48a848;fontStyle=1;fontSize=11;",
  context:         "rounded=1;fillColor=#e8f4e8;strokeColor=#2e7d32;fontStyle=1;fontSize=11;dashed=1;strokeWidth=2;",
  boundary:        "rounded=1;fillColor=#fde8e8;strokeColor=#c62828;fontStyle=1;fontSize=11;strokeWidth=2;",
  application:     "rounded=1;fillColor=#e3f2fd;strokeColor=#1565c0;fontStyle=1;fontSize=11;strokeWidth=2;",
  module:          "rounded=1;fillColor=#f3e5f5;strokeColor=#8e24aa;fontStyle=1;fontSize=11;",
}

const typeSizes: Record<ComponentType, { w: number; h: number }> = {
  component:       { w: 120, h: 60 },
  service:         { w: 120, h: 60 },
  microservice:    { w: 120, h: 60 },
  frontend:        { w: 120, h: 60 },
  gateway:         { w: 120, h: 60 },
  database:        { w: 60,  h: 70 },
  table:           { w: 100, h: 60 },
  schema:          { w: 110, h: 60 },
  queue:           { w: 60,  h: 60 },
  external:        { w: 120, h: 60 },
  platform:        { w: 120, h: 60 },
  library:         { w: 120, h: 60 },
  "data-pipeline": { w: 140, h: 60 },
  storage:         { w: 60,  h: 70 },
  "batch-job":     { w: 120, h: 60 },
  cache:           { w: 60,  h: 60 },
  context:         { w: 160, h: 80 },
  boundary:        { w: 160, h: 80 },
  application:     { w: 140, h: 70 },
  module:          { w: 100, h: 50 },
}

const connectorEntries = [
  {
    title: "REST",
    xml: `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" style="endArrow=block;endFill=1;strokeColor=#6c8ebf;fontSize=10;" value="REST" connector_type="rest" edge="1"><mxGeometry width="120" height="20" as="geometry"/></mxCell></root></mxGraphModel>`,
    w: 120, h: 20,
  },
  {
    title: "Async",
    xml: `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" style="endArrow=block;endFill=0;dashed=1;strokeColor=#b85450;fontSize=10;" value="Async" connector_type="async" edge="1"><mxGeometry width="120" height="20" as="geometry"/></mxCell></root></mxGraphModel>`,
    w: 120, h: 20,
  },
  {
    title: "DB",
    xml: `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" style="endArrow=ERmany;endFill=0;strokeColor=#d6b656;fontSize=10;" value="DB" connector_type="db" edge="1"><mxGeometry width="120" height="20" as="geometry"/></mxCell></root></mxGraphModel>`,
    w: 120, h: 20,
  },
  {
    title: "Table",
    xml: `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" style="endArrow=ERmany;endFill=0;strokeColor=#d97706;fontSize=10;dashed=0;" value="Table" connector_type="table" edge="1"><mxGeometry width="120" height="20" as="geometry"/></mxCell></root></mxGraphModel>`,
    w: 120, h: 20,
  },
  {
    title: "gRPC",
    xml: `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" style="endArrow=block;endFill=1;strokeColor=#9673a6;fontSize=10;" value="gRPC" connector_type="grpc" edge="1"><mxGeometry width="120" height="20" as="geometry"/></mxCell></root></mxGraphModel>`,
    w: 120, h: 20,
  },
  {
    title: "File",
    xml: `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" style="endArrow=open;endFill=0;dashed=1;strokeColor=#999999;fontSize=10;" value="File" connector_type="file" edge="1"><mxGeometry width="120" height="20" as="geometry"/></mxCell></root></mxGraphModel>`,
    w: 120, h: 20,
  },
  {
    title: "Human",
    xml: `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" style="endArrow=open;endFill=0;dashed=1;strokeColor=#d79b00;fontSize=10;" value="Human" connector_type="human" edge="1"><mxGeometry width="120" height="20" as="geometry"/></mxCell></root></mxGraphModel>`,
    w: 120, h: 20,
  },
  {
    title: "Info",
    xml: `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" style="endArrow=block;endFill=1;strokeColor=#2196f3;strokeWidth=2;fontSize=10;" value="Info" connector_type="info" edge="1"><mxGeometry width="120" height="20" as="geometry"/></mxCell></root></mxGraphModel>`,
    w: 120, h: 20,
  },
  {
    title: "Link",
    xml: `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" style="endArrow=none;strokeColor=#607d8b;fontSize=10;" value="Link" connector_type="link" edge="1"><mxGeometry width="120" height="20" as="geometry"/></mxCell></root></mxGraphModel>`,
    w: 120, h: 20,
  },
  {
    title: "Data",
    xml: `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" style="endArrow=block;endFill=1;strokeColor=#db2777;strokeWidth=2;fontSize=10;" value="Data" connector_type="data" edge="1"><mxGeometry width="120" height="20" as="geometry"/></mxCell></root></mxGraphModel>`,
    w: 120, h: 20,
  },
]

// Encode < and > for embedding in XML. Do NOT encode quotes — the xml values
// go inside JSON strings where JSON.stringify handles quote escaping with \".
// Encoding quotes as &quot; causes double-escaping when Draw.io parses the
// outer XML first (converting &quot; back to ") which then breaks the JSON.
function encodeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function buildComponentXml(component: Component): string {
  const size = typeSizes[component.type]
  const style = typeStyles[component.type]

  const raw =
    `<mxGraphModel><root>` +
    `<mxCell id="0"/><mxCell id="1" parent="0"/>` +
    `<UserObject label="${component.id}" arch_id="${component.id}" arch_type="${component.type}" id="2">` +
    `<mxCell style="${style}" vertex="1" parent="1">` +
    `<mxGeometry height="${size.h}" width="${size.w}" as="geometry"/>` +
    `</mxCell></UserObject>` +
    `</root></mxGraphModel>`

  return encodeXml(raw)
}

export function generateMxLibrary(components: Component[]): string {
  const componentEntries = components.map((c) => ({
    xml: buildComponentXml(c),
    w: typeSizes[c.type].w,
    h: typeSizes[c.type].h,
    title: c.id,
  }))

  const encodedConnectors = connectorEntries.map((e) => ({
    ...e,
    xml: encodeXml(e.xml),
  }))

  const allEntries = [...componentEntries, ...encodedConnectors]
  return `<mxlibrary>${JSON.stringify(allEntries)}</mxlibrary>`
}
