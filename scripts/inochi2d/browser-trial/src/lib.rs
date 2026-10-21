//! Local trusted-fixture research harness, not an untrusted public model loader.
//! Runtime source: Inochi2D/inox2d d4dd9dd7f16b775042cbda44370570abf9a8cf81.
use glam::Vec2;
use inox2d::{formats::inp::parse_inp, puppet::Puppet, render::InoxRendererExt};
use inox2d_opengl::OpenglRenderer;
use wasm_bindgen::{prelude::*, JsCast};

#[wasm_bindgen]
pub struct Preview { puppet: Puppet, renderer: OpenglRenderer }

#[wasm_bindgen]
impl Preview {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8], canvas: web_sys::HtmlCanvasElement) -> Result<Preview, JsValue> {
        console_error_panic_hook::set_once();
        if bytes.len() > 16 * 1024 * 1024 { return Err(JsValue::from_str("Research model exceeds 16 MiB")); }
        let options = js_sys::Object::new();
        js_sys::Reflect::set(&options, &"stencil".into(), &true.into())?;
        js_sys::Reflect::set(&options, &"preserveDrawingBuffer".into(), &true.into())?;
        let gl: web_sys::WebGl2RenderingContext = canvas
            .get_context_with_context_options("webgl2", &options)?
            .ok_or_else(|| JsValue::from_str("WebGL2 unavailable"))?.dyn_into()?;
        let mut model = parse_inp(bytes).map_err(|e| JsValue::from_str(&e.to_string()))?;
        model.puppet.init_transforms();
        model.puppet.init_rendering();
        model.puppet.init_params();
        // This controlled fixture contains no physics; time stepping remains 0.
        let mut renderer = OpenglRenderer::new(glow::Context::from_webgl2_context(gl), &model)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        renderer.camera.scale = Vec2::splat(1.2);
        renderer.resize(canvas.width(), canvas.height());
        Ok(Preview { puppet: model.puppet, renderer })
    }

    /// Values are passed unchanged to baseline runtime, including exact zero.
    pub fn render(&mut self, left: f32, right: f32, head: f32) -> Result<(), JsValue> {
        if ![left,right,head].iter().all(|v| v.is_finite()) || !(0.0..=1.0).contains(&left) || !(0.0..=1.0).contains(&right) || !(-1.0..=1.0).contains(&head) {
            return Err(JsValue::from_str("Parameter out of fixture range"));
        }
        self.puppet.begin_frame();
        let context = self.puppet.param_ctx.as_mut().unwrap();
        for (name,value) in [("EyeOpenL",left),("EyeOpenR",right),("HeadX",head)] {
            context.set(name,Vec2::new(value,0.0)).map_err(|e| JsValue::from_str(&e.to_string()))?;
        }
        self.puppet.end_frame(0.0);
        self.renderer.clear();
        self.renderer.on_begin_draw(&self.puppet);
        self.renderer.draw(&self.puppet);
        self.renderer.on_end_draw(&self.puppet);
        Ok(())
    }

    pub fn deforms(&self) -> Vec<f32> {
        self.puppet.render_ctx.as_ref().unwrap().vertex_buffers.deforms.iter()
            .flat_map(|v| [v.x,v.y]).collect()
    }
}
