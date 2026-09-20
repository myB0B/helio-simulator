import { MercatorCoordinate } from "maplibre-gl";

const vertexShaderSource = `
  attribute vec3 a_position;
  attribute vec3 a_normal;
  attribute vec4 a_color;
  uniform mat4 u_matrix;
  uniform vec4 u_origin_clip;
  uniform float u_meter;
  varying vec3 v_normal;
  varying vec4 v_color;
  void main() {
    vec4 localOffset = vec4(a_position.x * u_meter, -a_position.y * u_meter, a_position.z * u_meter, 0.0);
    gl_Position = u_origin_clip + u_matrix * localOffset;
    v_normal = vec3(a_normal.x, -a_normal.y, a_normal.z);
    v_color = a_color;
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  uniform vec3 u_sun_direction;
  varying vec3 v_normal;
  varying vec4 v_color;
  void main() {
    vec3 light = normalize(vec3(-0.4, -0.5, 0.8));
    vec3 normal = normalize(v_normal);
    float illumination = 0.35 + 0.65 * max(0.0, dot(normalize(v_normal), light));
    vec3 halfVector = normalize(normalize(u_sun_direction) + vec3(0.0, 0.0, 1.0));
    float reflection = pow(max(0.0, dot(normal, halfVector)), 48.0) * max(0.0, u_sun_direction.z) * v_color.a;
    gl_FragColor = vec4(min(vec3(1.0), v_color.rgb * illumination + vec3(reflection * 0.75)), 1.0);
  }
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  const message = gl.getShaderInfoLog(shader);
  gl.deleteShader(shader);
  throw new Error(`Unable to compile 3D project shader: ${message}`);
}

function mercatorOrigin(origin) {
  const mercator = MercatorCoordinate.fromLngLat(origin, 0);
  return {
    position: [mercator.x, mercator.y, mercator.z, 1],
    meter: mercator.meterInMercatorCoordinateUnits(),
  };
}

function projectOrigin(matrix, position) {
  const [x, y, z, w] = position;
  return new Float32Array([
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * w,
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * w,
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * w,
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] * w,
  ]);
}

export class SolarProject3DLayer {
  constructor(id = "solar-project-3d") {
    this.id = id;
    this.type = "custom";
    this.renderingMode = "3d";
    this.projects = [];
    this.visible = true;
    this.sunDirection = [0, 0, 1];
  }

  onAdd(map, gl) {
    this.map = map;
    this.gl = gl;
    const program = gl.createProgram();
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Unable to link 3D project shader: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    this.attributes = {
      position: gl.getAttribLocation(program, "a_position"),
      normal: gl.getAttribLocation(program, "a_normal"),
      color: gl.getAttribLocation(program, "a_color"),
    };
    this.uniforms = {
      matrix: gl.getUniformLocation(program, "u_matrix"),
      originClip: gl.getUniformLocation(program, "u_origin_clip"),
      meter: gl.getUniformLocation(program, "u_meter"),
      sunDirection: gl.getUniformLocation(program, "u_sun_direction"),
    };
    this.uploadProjects();
  }

  setProjects(projects) {
    this.projects = projects;
    if (this.gl) this.uploadProjects();
    this.map?.triggerRepaint();
  }

  setVisible(visible) {
    this.visible = visible;
    this.map?.triggerRepaint();
  }

  setSunPosition(position) {
    const azimuth = Number(position?.azimuth);
    const altitude = Number(position?.altitude);
    if (!Number.isFinite(azimuth) || !Number.isFinite(altitude)) return;
    const azimuthRadians = (azimuth * Math.PI) / 180;
    const altitudeRadians = (altitude * Math.PI) / 180;
    const horizontal = Math.cos(altitudeRadians);
    // Local geometry is east/north/up; the shader flips the north axis for MapLibre.
    this.sunDirection = [
      Math.sin(azimuthRadians) * horizontal,
      -Math.cos(azimuthRadians) * horizontal,
      Math.sin(altitudeRadians),
    ];
    this.map?.triggerRepaint();
  }

  deleteProjectResources(project) {
    if (!this.gl || !project.buffers) return;
    Object.values(project.buffers).forEach((buffer) => this.gl.deleteBuffer(buffer));
    if (project.vao) this.gl.deleteVertexArray(project.vao);
  }

  uploadProjects() {
    this.renderProjects?.forEach((project) => this.deleteProjectResources(project));
    this.renderProjects = this.projects.map((project) => {
      const { gl } = this;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const upload = (target, data) => {
        const buffer = gl.createBuffer();
        gl.bindBuffer(target, buffer);
        gl.bufferData(target, data, gl.STATIC_DRAW);
        return buffer;
      };
      const buffers = {
        positions: upload(gl.ARRAY_BUFFER, project.positions),
        normals: upload(gl.ARRAY_BUFFER, project.normals),
        colors: upload(gl.ARRAY_BUFFER, project.colors),
        indices: upload(gl.ELEMENT_ARRAY_BUFFER, project.indices),
      };
      const bindAttribute = (buffer, attribute, size) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, 0, 0);
      };
      bindAttribute(buffers.positions, this.attributes.position, 3);
      bindAttribute(buffers.normals, this.attributes.normal, 3);
      bindAttribute(buffers.colors, this.attributes.color, 4);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);
      gl.bindVertexArray(null);
      return {
        ...project,
        mercatorOrigin: mercatorOrigin(project.origin),
        buffers,
        vao,
      };
    });
  }

  render(gl, options) {
    if (!this.visible || !this.renderProjects?.length) return;
    const matrix = options.defaultProjectionData.mainMatrix;
    const previousProgram = gl.getParameter(gl.CURRENT_PROGRAM);
    const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    const depthTestEnabled = gl.isEnabled(gl.DEPTH_TEST);
    const blendEnabled = gl.isEnabled(gl.BLEND);
    const cullFaceEnabled = gl.isEnabled(gl.CULL_FACE);
    const depthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
    gl.useProgram(this.program);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.uniform3fv(this.uniforms.sunDirection, this.sunDirection);
    this.renderProjects.forEach((project) => {
      gl.bindVertexArray(project.vao);
      gl.uniformMatrix4fv(this.uniforms.matrix, false, new Float32Array(matrix));
      gl.uniform4fv(this.uniforms.originClip, projectOrigin(matrix, project.mercatorOrigin.position));
      gl.uniform1f(this.uniforms.meter, project.mercatorOrigin.meter);
      gl.drawElements(gl.TRIANGLES, project.indices.length, gl.UNSIGNED_INT, 0);
    });
    gl.bindVertexArray(previousVao);
    gl.useProgram(previousProgram);
    if (depthTestEnabled) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    if (blendEnabled) gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
    if (cullFaceEnabled) gl.enable(gl.CULL_FACE);
    else gl.disable(gl.CULL_FACE);
    gl.depthMask(depthMask);
  }

  onRemove() {
    this.renderProjects?.forEach((project) => this.deleteProjectResources(project));
    if (this.gl && this.program) this.gl.deleteProgram(this.program);
    this.renderProjects = [];
    this.program = undefined;
    this.gl = undefined;
  }
}
