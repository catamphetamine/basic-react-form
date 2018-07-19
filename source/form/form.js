import { Component, createElement } from 'react'
import PropTypes from 'prop-types'
import hoist_statics from 'hoist-non-react-statics'

import create_context, { context_prop_type } from './context'
import build_outer_component from './wrapper'
import redux_state_connector from './connect'
import { get_configuration } from '../configuration'
import { initial_form_state } from '../reducer'

// <Form
// 	action={this.submit}>
//
// 	<Field
// 		component={Text_input}
// 		value="Text"
// 		validate={this.validate_email}
// 		error="Optional externally set error (aside validation)"/>
//
// 	<button type="submit">Submit</button>
// </Form>
//
// validate_email(value) { return 'Error message' }
//
// submit(values) { ... }
//
export function decorator_with_options(options = {})
{
	options = normalize_options(options)

	return function createFormComponent(FormComponent)
	{
		class Form extends Component
		{
			static propTypes =
			{
				// Form id (required)
				// (is set by the @Form() decorator)
				id : PropTypes.string,

				// These two React properties
				// can be set on the decorated form element
				// and they will be transformed into the `id` property above.
				form_id : PropTypes.string,
				formId  : PropTypes.string,

				// Initial form field values
				// (is set by the @Form() decorator
				//  gathering `value`s from all `<Field/>`s)
				initial_values : PropTypes.object,

				// Whether the form is being submitted right now
				// (is set by the @Form() decorator's `submitting` option)
				submitting : PropTypes.bool
			}

			static contextTypes =
			{
				router : PropTypes.object
			}

			static childContextTypes =
			{
				simpler_redux_form : context_prop_type
			}

			state =
			{
				submitting : undefined
			}

			// The stored field info is used to `validate()` field `value`s 
			// and set the corresponding `error`s
			// when calling `set(field, value)` and `clear(field)`.
			// It also holds initial field values for form `reset()`.
			fields = {}

			componentWillMount()
			{
				const { id, initialize_form, initial_values } = this.props

				// First `form.constructor` is called,
				// then `form.componentWillMount` is called,
				// then `field.constructor` is called,
				// then `field.componentWillMount` is called,
				// then `field.componentDidMount` is called,
				// then `form.componentDidMount` is called.
				initialize_form(id, initial_values)
			}

			componentDidMount()
			{
				const { onAbandoned } = this.props
				const { router } = this.context

				if (onAbandoned && router && router.setRouteLeaveHook)
				{
					// If the last route is left it means navigation takes place
					const route = router.routes[router.routes.length - 1]
					this.deactivate_route_leave_hook = router.setRouteLeaveHook(route, this.report_if_form_is_abandoned);
				}
			}

			componentWillReceiveProps(new_props)
			{
				const { initialized } = this.props
				
				// Autofocus the form when it's mounted and all of its fields are initialized.
				if (!initialized && new_props.initialized && options.autofocus !== false)
				{
					this.focus(undefined, new_props)
				}
			}

			componentWillUnmount()
			{
				const { id, destroy_form } = this.props

				destroy_form(id)

				this.will_be_unmounted = true

				this.report_if_form_is_abandoned()
			}

			getChildContext()
			{
				return {
					simpler_redux_form: create_context(this, options)
            }
			}

			should_validate_visited_fields()
			{
				const { validateVisitedFields } = this.props

				if (validateVisitedFields !== undefined)
				{
					return validateVisitedFields
				}

				if (options.validateVisitedFields !== undefined)
				{
					return options.validateVisitedFields
				}

				if (get_configuration().validateVisitedFields !== undefined)
				{
					return get_configuration().validateVisitedFields
				}
			}

			should_trim_field_values()
			{
				if (options.trim !== undefined)
				{
					return options.trim
				}

				if (get_configuration().trim !== undefined)
				{
					return get_configuration().trim
				}
			}

			stop_form_abandoned_listener()
			{
				if (this.deactivate_route_leave_hook)
				{
					this.deactivate_route_leave_hook()
				}
			}

			report_if_form_is_abandoned = () =>
			{
				// If the form is already submitted
				// then it's not abandoned.
				if (this.submitted)
				{
					return
				}

				// Get the latest focused form field
				const field = this.get_latest_focused_field()

				// If no form field was ever focused
				// then the form is not being abandoned.
				if (!field)
				{
					return
				}

				const { onAbandoned } = this.props

				this.stop_form_abandoned_listener()

				if (onAbandoned)
				{
					onAbandoned(this.props, field, this.get_field_value(field))
				}
			}

			// `value` is initial field value
			// (which is restored on form reset)
			register_field(field, value, validate)
			{
				// The stored field info is used to `validate()` field `value`s 
				// and set the corresponding `error`s
				// when calling `set(field, value)` and `clear(field)`.
				// It also holds initial field values for form `reset()`.
				//
				// If a field happens to register the second time
				// (e.g. due to React "reconciliation" due to order change)
				// then no need to update its info.
				// This also prevents loosing the initial value of the field.
				//
				if (!this.fields[field])
				{
					this.fields[field] = { value, validate }
				}

				// This is used for `autofocus` feature
				if (!this.initially_first_field)
				{
					this.initially_first_field = field
				}
			}

			unregister_field(field, value, validate)
			{
				// The field info is not deleted on "unregister"
				// because this field can then be mounted right away after unmounting
				// due to internal React trickery ("reconciliation").
				// Therefore field info is retained.
				// This also preserves the initial value of the field.
				// delete this.fields[field]
			}

			// Public API
			reset = () =>
			{
				const { fields, initial_values } = this.props

				for (const field of Object.keys(fields))
				{
					this.set_field(field, initial_values[field])
				}

				// Make the form "untouched" again
				this.reset_form_invalid_indication()

				// Autofocus the form (if not configured otherwise)
				if (options.autofocus !== false)
				{
					this.focus()
				}
			}

			// Public API
			focus = (field, props = this.props) =>
			{
				// Focus on the first form field by default
				if (!field)
				{
					field = this.initially_first_field
				}

				this.focus_field(field)
			}

			// Resets invalid indication for the whole form
			reset_form_invalid_indication = () =>
			{
				this.props.reset_form_invalid_indication(this.props.id)
			}

			// Is called when the form has been submitted.
			form_submitted = () =>
			{
				this.submitted = true
				this.stop_form_abandoned_listener()

				const { onSubmitted } = this.props

				if (onSubmitted)
				{
					onSubmitted(this.props)
				}

				// Return a non-undefined value so that `bluebird` doesn't complain.
				// http://bluebirdjs.com/docs/warning-explanations.html#warning-a-promise-was-created-in-a-handler-but-was-not-returned-from-it
				return null
			}

			validate()
			{
				const
				{
					id,
					fields,
					values,
					errors,
					set_form_validation_passed,
					indicate_invalid_field
				}
				=
				this.props

				// Ignores previous form submission errors until validation passes
				set_form_validation_passed(id, false)

				// Revalidate fields.
				// (because normally they only get validated
				//  in `onChange` handlers, and advanced `validate()`
				//  functions can be realtime (stateful) rather than stateless,
				//  e.g. depending on `this.state` properties)
				for (const field of Object.keys(fields))
				{
					this.set_field(field, values[field])
				}

				// Check if there are any invalid fields
				const invalid_fields = Object.keys(fields)
					.filter(field => fields[field])
					.filter(field => errors[field] !== undefined)

				// If some of the form fields are invalid
				if (invalid_fields.length > 0)
				{
					// Indicate the first invalid field error
					indicate_invalid_field(id, invalid_fields[0])

					// Scroll to the invalid field
					this.scroll_to_field(invalid_fields[0])

					// Focus the invalid field
					this.focus_field(invalid_fields[0])

					return false
				}

				// Stop ignoring form submission errors
				set_form_validation_passed(id, true)
			}

			collect_form_data()
			{
				const { fields, values } = this.props

				// Pass only registered fields to form submit action
				// (because if a field is unregistered that means that
				//  its React element was removed in the process,
				//  and therefore it's not needed anymore)
				const should_trim = this.should_trim_field_values()
				return Object.keys(fields).reduce((form_data, field) => 
				{
					let value = values[field]
					
					if (should_trim && typeof value === 'string')
					{
						value = value.trim()
					}

					form_data[field] = value
					return form_data
				},
				{})
			}

			// Calls `<form/>`'s `onSubmit` action.
			execute_form_action(action, form_data)
			{
				let result

				try
				{
					result = action(form_data)
				}
				catch (error)
				{
					if (this.handle_error(error) === false)
					{
						throw error
					}
				}

				// If the form submit action returned a `Promise`
				// then track this `Promise`'s progress.
				if (result && typeof result.then === 'function')
				{
					this.submit_promise(result)
				}
				else
				{
					this.form_submitted()
				}
			}

			handle_error = (error) =>
			{
				const handle_error = options.onError || get_configuration().defaultErrorHandler
				return handle_error(error, this.props)
			}

			// Is called when `<form/>` `onSubmit` returns a `Promise`.
			submit_promise(promise)
			{
				this.setState({ submitting: true })

				let throw_error
				promise.then(this.form_submitted, (error) =>
				{
					if (this.handle_error(error) === false)
					{
						throw_error = error
					}
				})
				.then(() =>
				{
					if (!this.will_be_unmounted)
					{
						// Set `submitting` flag back to `false`
						this.setState({ submitting: false })
					}

					if (throw_error)
					{
						throw throw_error
					}
				})
			}

			// Creates form submit handler
			// (this function is passed as a property)
			submit = (before_submit, action) =>
			{
				if (!action)
				{
					action = before_submit
					before_submit = undefined
				}

				if (!action)
				{
					throw new Error(`No action specified for form "submit"`)
				}

				return (event) =>
				{
					// Not returning the `Promise`
					// so that `bluebird` doesn't complain.
					this.on_submit(event, before_submit, action)
				}
			}

			on_submit(event, before_submit, action)
			{
				// If it's an event handler then `.preventDefault()` it
				// (which is the case for the intended
				//  `<form onSubmit={ submit(...) }/>` use case)
				if (event && typeof event.preventDefault === 'function')
				{
					event.preventDefault()
				}

				// Do nothing if the form is submitting
				// (i.e. submit is in progress)
				if (this.state.submitting || this.props.submitting)
				{
					return false
				}

				// Can be used, for example, to reset
				// custom error messages.
				// (not <Field/> `error`s)
				// E.g. it could be used to reset
				// overall form errors like "Form submission failed".
				if (before_submit)
				{
					before_submit()
				}

				// Submit the form if it's valid.
				// Otherwise mark invalid fields.
				if (this.validate() === false)
				{
					return false
				}

				this.execute_form_action(action, this.collect_form_data())
			}

			// Focuses on a given form field (used internally + public API)
			focus_field = (field) =>
			{
				const { id, focus_field } = this.props

				focus_field(id, field)
			}

			// Scrolls to a form field (used internally + public API)
			scroll_to_field = (field) =>
			{
				const { id, scroll_to_field } = this.props

				scroll_to_field(id, field)
			}

			// Clears field value (public API)
			clear_field = (field) =>
			{
				const { id, values, clear_field } = this.props

				// If this field hasn't been "registered" yet then ignore.
				if (!this.fields[field]) {
					return
				}

				const validate = this.fields[field].validate
				clear_field(id, field, validate(undefined, values))
			}

			// Gets field value (public API)
			get_field_value = (field) =>
			{
				const { values } = this.props

				return values[field]
			}

			// Sets field value (public API)
			set_field = (field, value) =>
			{
				const { id, values, set_field } = this.props

				const validate = this.fields[field].validate
				set_field(id, field, value, validate(value, values))
			}

			// Gets the latest focused field (public API).
			// (e.g. for Google Analytics on abandoned forms)
			get_latest_focused_field = () =>
			{
				const { misc: { latest_focused_field } } = this.props

				return latest_focused_field
			}

			// Pass through all non-internal React `props`
			passthrough_props()
			{
				const passed_props = {}

				// Drop all inner props.
				// All other user-specified props are passed on.
				for (const prop_name of Object.keys(this.props))
				{
					// Drop all inner props
					if (Form.propTypes[prop_name] || form_state_properties[prop_name])
					{
						continue
					}

					passed_props[prop_name] = this.props[prop_name]
				}

				return passed_props
			}

			store_instance = (ref) =>
			{
				this.user_form = ref
			}

			extra_props()
			{
				return {
					ref    : this.store_instance,
					reset  : this.reset,
					submit : this.submit,
					focus  : this.focus,
					scroll : this.scroll_to_field,
					clear  : this.clear_field,
					get    : this.get_field_value,
					set    : this.set_field,
					submitting : this.state.submitting || this.props.submitting,
					resetInvalidIndication : this.reset_form_invalid_indication,
					// Deprecated, use camelCase name instead.
					reset_invalid_indication : this.reset_form_invalid_indication,
					getLatestFocusedField : this.get_latest_focused_field
				}
			}

			render()
			{
				return createElement(FormComponent,
				{
					...this.passthrough_props(),
					...this.extra_props()
				})
			}
		}

		// A more meaningful React `displayName`
		Form.displayName = `Form(${get_display_name(FormComponent)})`

		// Connect the form component to Redux state
		const Connected_form = redux_state_connector(options)(Form)

		// Build an outer component
		// with the only purpose
		// to expose instance API methods
		const ReduxForm = build_outer_component(Connected_form, options)

		// Preserve all static methods and properties
		// defined on the original decorated component
		return hoist_statics(ReduxForm, FormComponent)
	}
}

function get_display_name(Wrapped)
{
	return Wrapped.displayName || Wrapped.name || 'Component'
}

function normalize_options(options)
{
	if (typeof options === 'string')
	{
		options = { id: options }
	}
	else
	{
		options = { ...options }
	}

	return options
}

const decorator = decorator_with_options()
export default decorator

const form_state_properties = Object.keys(initial_form_state())